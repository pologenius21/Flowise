# Walmart Spending Insights App (Product Blueprint)

## 1) Product goal
Build an app that continuously analyzes Walmart receipt history to help a shopper reduce grocery costs by answering:
- **When** should I buy each item?
- **How much** should I buy at once?
- **Should I buy in bulk and store/freeze?**
- **How much can I save in dollars, trips, gas, and time?**

## 2) Core value proposition
The app turns passive receipt history into personalized, actionable recommendations, such as:
- “You buy Goldfish ~3 times/month. If you buy 4 packs during week 1, you can save $8.40/month.”
- “Ground beef is 14% cheaper in winter than peak summer BBQ months. Buying and freezing 6 lbs in January can save ~$42/year.”

## 3) Main user stories
1. As a shopper, I want my Walmart receipts imported automatically so I do not enter purchases manually.
2. As a shopper, I want item-level price trends over time (week/month/season) so I can time purchases.
3. As a shopper, I want estimated consumption rates so I can buy the right quantity.
4. As a shopper, I want storage-aware recommendations (freeze/pantry/fridge) so bulk buying is realistic.
5. As a shopper, I want quantified tradeoff summaries (price, gas, trip count, time) so I can decide quickly.

## 4) Functional requirements
### Receipt + transaction ingestion
- Import Walmart receipts from the user account (API integration if available, else secure email/receipt parsing fallback).
- Normalize line items to canonical products:
  - e.g., “Goldfish Cheddar 6.6oz”, “Pepperidge Goldfish 6.6 oz” -> same product SKU cluster.
- Track quantity, effective unit price, discounts, coupon impact, purchase date/time, store/online context.

### Price intelligence
- Build per-item price timelines with:
  - rolling averages,
  - volatility score,
  - month/season decomposition,
  - promotion frequency detection.
- Flag “seasonality-sensitive” products (meat, grilling supplies, holiday items).

### Consumption intelligence
- Estimate household consumption rate by item using purchase frequency + quantity.
- Detect stock-up behavior vs emergency top-ups.
- Infer likely stockout window (when user will run out).

### Recommendation engine
For each recurring item, calculate and rank opportunities:
1. **Bulk strategy**: buy larger quantity now vs normal cadence.
2. **Timing strategy**: delay/advance purchase to lower expected price window.
3. **Trip consolidation strategy**: combine purchases to reduce extra store trips.
4. **Substitution strategy (optional)**: same category, lower average cost alternatives.

Recommendation output should include:
- expected savings ($/month and $/year),
- confidence score,
- assumptions (freezer capacity, spoilage risk, gas cost, distance),
- “why” explanation in plain language.

### Alerts + automation
- “Buy now” alerts when item price drops below user-specific threshold.
- “Stock-up window” alerts for seasonally low periods.
- Monthly optimization digest with top 5 savings actions.

## 5) Data model (minimum)
### Entities
- `User`
- `Receipt`
- `ReceiptLineItem`
- `CanonicalProduct`
- `PriceObservation`
- `ConsumptionProfile`
- `Recommendation`
- `SavingsEvent`

### Key fields
- `PriceObservation`: `canonical_product_id`, `purchase_date`, `unit_price`, `promo_flag`, `quantity`
- `ConsumptionProfile`: `avg_daily_units`, `confidence`, `storage_type`, `max_stock_days`
- `Recommendation`: `type`, `trigger_window`, `estimated_savings_monthly`, `estimated_savings_yearly`, `confidence`, `explanation`

## 6) Analytics methods (practical v1)
- **Item matching**: hybrid rules + embedding similarity for noisy receipt text.
- **Seasonality detection**: STL decomposition or month-level regression per item.
- **Consumption forecasting**: simple exponential smoothing with outlier clipping.
- **Savings simulation**:
  - baseline = observed buying cadence,
  - candidate policy = bulk/timed buying plan,
  - simulate 3–12 months and compare total spend + trip costs.

## 7) Savings formula examples
- **Unit price savings** = `(baseline_unit_price - recommended_unit_price) * expected_units`
- **Trip savings** = `reduced_trips * (gas_cost_per_trip + value_of_time_per_trip)`
- **Net savings** = `unit_price_savings + trip_savings - spoilage_risk_cost - storage_cost`

## 8) UX surfaces
- Dashboard cards:
  - “This month potential savings: $X”
  - “Best item to stock up this week”
- Item detail page:
  - price history chart,
  - recommended buy windows,
  - quantity suggestion.
- Planning view:
  - “Buy now”, “Wait”, and “Skip this trip” actions.

## 9) Privacy + trust requirements
- Explicit permission for Walmart account/receipt access.
- Data encryption at rest and in transit.
- User controls for deleting history and turning off recommendations.
- Transparent “how recommendation was computed” panel.

## 10) Flowise-oriented implementation concept
Use Flowise as the orchestration layer for conversational insights:
1. **Ingestion node chain**: parse receipts -> normalize items -> store observations.
2. **Analytics tool nodes**: query item history + compute seasonality/consumption metrics.
3. **Recommendation agent**: produces ranked, explainable savings actions.
4. **Notification workflow**: scheduled flow sends monthly digest and price-drop alerts.

## 11) MVP scope (first release)
- Walmart receipt ingestion for one account.
- Top 50 recurring products only.
- Price trend + monthly seasonality for each product.
- Bulk-buy and timing recommendations with confidence.
- Monthly digest + manual “optimize my cart” query.

## 12) Success metrics
- 90-day retained users.
- Average monthly savings/user.
- Recommendation acceptance rate.
- Reduction in shopping trip count.
- User trust score on recommendation explanations.
