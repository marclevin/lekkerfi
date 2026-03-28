# Financial Insights Visualization Guide

## Overview

The Financial Insights Visualization service generates comprehensive visual representations of transaction data, including charts, graphs, and statistical summaries. It transforms raw transaction data into actionable financial insights displayed as professional visualizations.

## Architecture

```
Transaction Data
       │
       ▼
Financial Insights Visualizer
       │
       ├─ Spending Overview (Income vs Expenses)
       ├─ Category Breakdown (Top Merchants)
       ├─ Daily Spending Trend
       ├─ Balance Over Time
       ├─ Top Transactions
       ├─ Cumulative Spending
       │
       ▼
   Visualizations
    (PNG Images)
       │
    Stored in:
    exports/visualizations/
```

## Features

### Visualization Types

1. **Spending Overview**
   - Bar chart comparing income, expenses, and net flow
   - Pie chart showing income vs expenses distribution
   - Key metrics displayed on charts

2. **Category Breakdown**
   - Horizontal bar chart of top 10 merchants/categories
   - Spending amounts clearly labeled
   - Color-coded for easy identification

3. **Daily Spending Trend**
   - Line chart showing daily income and expenses
   - Filled areas below lines for visual impact
   - Time period clearly marked on x-axis

4. **Balance Over Time**
   - Line chart showing account balance progression
   - Visual representation of balance fluctuations
   - Highlights min, max, and final balance values

5. **Top Transactions**
   - Bar chart of the 10 largest transactions
   - Color-coded by type (green for income, red for expenses)
   - Transaction descriptions and amounts labeled

6. **Cumulative Spending**
   - Line chart showing total spending accumulation
   - Visual trend of spending over time
   - Useful for identifying spending acceleration

## File Storage

Visualizations are stored in:
```
exports/visualizations/
├── spending_overview_20260327_123650.png
├── category_breakdown_20260327_123650.png
├── daily_trend_20260327_123650.png
├── balance_progression_20260327_123650.png
├── top_transactions_20260327_123650.png
└── cumulative_spending_20260327_123650.png
```

Each filename includes a timestamp (YYYYMMDD_HHMMSS) to ensure uniqueness.

## API Endpoints

### 1. Generate Insights
```
POST /api/generate-insights
Content-Type: application/json

Body:
{
  "data": { /* transaction data */ }
}

Or (uses stored statement_data):
{}

Response:
{
  "success": true,
  "message": "Financial insights generated successfully",
  "data": {
    "generated_at": "2026-03-27T12:36:50.123456",
    "transaction_count": 15,
    "visualizations": [
      {
        "type": "spending_overview",
        "title": "Spending Overview",
        "description": "Income: R1000.00 | Expenses: R975.00 | Net: R25.00",
        "file": "/path/to/exports/visualizations/spending_overview_20260327_123650.png",
        "filename": "spending_overview_20260327_123650.png",
        "data": {
          "income": 1000.00,
          "expenses": 975.00,
          "net": 25.00
        }
      },
      { /* more visualizations */ }
    ],
    "summary": {
      "total_transactions": 15,
      "total_income": 1000.00,
      "total_expenses": 975.00,
      "net_flow": 25.00,
      "average_transaction": 631.67,
      "largest_income": 1000.00,
      "largest_expense": -975.00,
      "account_balance": 29270.40,
      "available_balance": 19729.60,
      "transaction_count_income": 1,
      "transaction_count_expenses": 2,
      "number_of_merchants": 3
    },
    "charts_json": { /* interactive plotly charts */ }
  }
}
```

### 2. List All Visualizations
```
GET /api/visualizations-list

Response:
{
  "success": true,
  "message": "Found 6 visualizations",
  "generated_at": "2026-03-27T12:36:50.123456",
  "transaction_count": 15,
  "summary": { /* summary stats */ },
  "visualizations": [
    {
      "index": 0,
      "type": "spending_overview",
      "title": "Spending Overview",
      "description": "Income: R1000.00 | Expenses: R975.00 | Net: R25.00",
      "filename": "spending_overview_20260327_123650.png"
    },
    { /* more visualizations */ }
  ]
}
```

### 3. Get Specific Visualization
```
GET /api/visualizations/<index>

Example: GET /api/visualizations/0

Response:
{
  "success": true,
  "visualization": {
    "type": "spending_overview",
    "title": "Spending Overview",
    "description": "...",
    "file": "/path/to/file.png",
    "filename": "spending_overview_20260327_123650.png",
    "data": { /* detailed data */ }
  }
}
```

### 4. Get Visualization Image
```
GET /api/visualization-image/<filename>

Example: GET /api/visualization-image/spending_overview_20260327_123650.png

Response: PNG image file
```

### 5. Get Insights Summary
```
GET /api/insights-summary

Response:
{
  "success": true,
  "summary": {
    "total_transactions": 15,
    "total_income": 1000.00,
    "total_expenses": 975.00,
    "net_flow": 25.00,
    "average_transaction": 631.67,
    "largest_income": 1000.00,
    "largest_expense": -975.00,
    "account_balance": 29270.40,
    "available_balance": 19729.60,
    "transaction_count_income": 1,
    "transaction_count_expenses": 2,
    "number_of_merchants": 3
  },
  "charts_available": true
}
```

## Usage Examples

### Complete Flow: Process → Simplify → Visualize

```bash
# 1. Upload statement
curl -X POST http://localhost:5000/api/upload-statement \
  -F "file=@statement.pdf"

# 2. Process statement
curl -X POST http://localhost:5000/api/process-statement \
  -H "Content-Type: application/json" \
  -d '{"file_path": "/path/to/file"}'

# 3. Generate insights
curl -X POST http://localhost:5000/api/generate-insights

# 4. List visualizations
curl http://localhost:5000/api/visualizations-list

# 5. Get specific visualization
curl http://localhost:5000/api/visualizations/0

# 6. Get visualization image
curl http://localhost:5000/api/visualization-image/spending_overview_20260327_123650.png \
  --output spending_overview.png

# 7. Get summary statistics
curl http://localhost:5000/api/insights-summary
```

### Python Integration

```python
from services.insights_visualizer import FinancialInsightsVisualizer

# Initialize visualizer
visualizer = FinancialInsightsVisualizer()

# Generate insights
insights_result = visualizer.generate_all_insights(transaction_data)

# Access visualizations
for viz in insights_result["visualizations"]:
    print(f"{viz['title']}: {viz['filename']}")
    print(f"  {viz['description']}")

# Access summary
summary = insights_result["summary"]
print(f"Total Income: R{summary['total_income']:,.2f}")
print(f"Total Expenses: R{summary['total_expenses']:,.2f}")
```

## JavaScript/Frontend Integration

### React Example

```javascript
import { useState, useEffect } from 'react';

function InsightsViewer() {
  const [visualizations, setVisualizations] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  // Generate insights
  const generateInsights = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/generate-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await response.json();
      setVisualizations(data.data.visualizations);
      setSummary(data.data.summary);
    } catch (error) {
      console.error('Failed to generate insights:', error);
    }
    setLoading(false);
  };

  // Render visualizations
  return (
    <div className="insights-container">
      <button onClick={generateInsights} disabled={loading}>
        {loading ? 'Generating...' : 'Generate Insights'}
      </button>

      {summary && (
        <div className="summary">
          <p>Income: R{summary.total_income.toFixed(2)}</p>
          <p>Expenses: R{summary.total_expenses.toFixed(2)}</p>
          <p>Net: R{summary.net_flow.toFixed(2)}</p>
        </div>
      )}

      <div className="visualizations-grid">
        {visualizations.map((viz, idx) => (
          <div key={idx} className="visualization-card">
            <h3>{viz.title}</h3>
            <img 
              src={`/api/visualization-image/${viz.filename}`} 
              alt={viz.title}
            />
            <p>{viz.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

## Data Structure

### Visualization Object

```json
{
  "type": "spending_overview",
  "title": "Spending Overview",
  "description": "Summary text",
  "file": "/absolute/path/to/file.png",
  "filename": "spending_overview_TIMESTAMP.png",
  "data": {
    // Type-specific data
    // For spending_overview:
    "income": 1000.00,
    "expenses": 975.00,
    "net": 25.00
    
    // For category_breakdown:
    // "merchants": { "Merchant": amount, ... }
    
    // For daily_trend:
    // "dates": ["2026-01-01", ...],
    // "daily_income": [0, 1000, ...],
    // "daily_expense": [100, 50, ...]
  }
}
```

### Summary Statistics

```json
{
  "total_transactions": 15,
  "total_income": 1000.00,
  "total_expenses": 975.00,
  "net_flow": 25.00,
  "average_transaction": 631.67,
  "largest_income": 1000.00,
  "largest_expense": -975.00,
  "account_balance": 29270.40,
  "available_balance": 19729.60,
  "transaction_count_income": 1,
  "transaction_count_expenses": 2,
  "number_of_merchants": 3
}
```

## Service Class: FinancialInsightsVisualizer

### Initialization

```python
from services.insights_visualizer import FinancialInsightsVisualizer

# Default output directory (exports/visualizations/)
visualizer = FinancialInsightsVisualizer()

# Custom output directory
visualizer = FinancialInsightsVisualizer(output_dir="/custom/path")
```

### Main Methods

#### `generate_all_insights(transaction_data: dict) -> dict`
Generates all available visualizations and statistics.

**Parameters:**
- `transaction_data`: Dict with `transactionHistory` key containing transaction data

**Returns:**
- Dict with `visualizations`, `summary`, and `charts_json`

**Raises:**
- `ValueError`: If no transactions found in data

#### `_parse_transactions(transactions: list) -> dict`
Organizes transactions by date, type, and merchant.

#### `_create_*` methods
Individual visualization generators:
- `_create_spending_overview()`
- `_create_category_breakdown()`
- `_create_daily_trend()`
- `_create_balance_progression()`
- `_create_top_transactions_chart()`
- `_create_cumulative_spending()`

#### `_generate_interactive_charts(parsed_trx: dict) -> dict`
Generates Plotly interactive charts (if plotly available).

## Styling and Appearance

### Chart Styling

- **Theme**: Matplotlib seaborn-v0_8-darkgrid style
- **Colors**: Set3 color palette (12 distinct colors)
- **Font Size**: 10-14pt depending on context
- **DPI**: 150 for crisp images
- **Grid**: Enabled with alpha=0.3 for subtle background

### Color Scheme

- **Income**: Green (#2ecc71)
- **Expenses**: Red (#e74c3c)
- **Balance**: Blue (#3498db)
- **Merchants**: Set3 palette (rotates through 12 colors)

## Error Handling

All endpoints return appropriate HTTP status codes:
- **200**: Success
- **400**: Client error (missing data)
- **403**: Security error (invalid file path)
- **404**: Not found (visualization index out of range)
- **500**: Server error (processing failed)

Error responses include detailed messages:
```json
{
  "error": "Description of what went wrong"
}
```

## Performance Considerations

- **Chart Generation Time**: 2-5 seconds for all visualizations
- **Memory Usage**: ~50-100MB for large transaction sets (1000+ transactions)
- **File Sizes**: PNG images typically 50-200KB each
- **Plotting Libraries**: Matplotlib for static, Plotly optional for interactive

### Optimization Tips

1. **Batch Processing**: Generate all visualizations at once
2. **Image Caching**: Store generated images to avoid re-rendering
3. **Data Limiting**: Show top 10 merchants instead of all
4. **Lazy Loading**: Load visualization images only when needed

## Dependencies

### Required
- `matplotlib` - Static chart generation
- `numpy` - Numerical processing

### Optional
- `plotly` - Interactive chart generation

## Future Enhancements

Potential improvements:
1. **Advanced Analytics**
   - Trend analysis and forecasting
   - Anomaly detection
   - Spending patterns by day/week/month

2. **Custom Reports**
   - Multi-month comparisons
   - Budget vs actual analysis
   - Goal tracking visualizations

3. **Interactive Dashboards**
   - Real-time chart updates
   - Drill-down functionality
   - Filtering and sorting

4. **Export Options**
   - PDF reports
   - CSV data export
   - Interactive HTML dashboards

5. **Machine Learning**
   - Spending categorization
   - Merchant classification
   - Anomaly detection

6. **Mobile Optimizations**
   - Responsive chart sizing
   - Touch-friendly interactions
   - Mobile-specific visualizations

## Troubleshooting

### Issue: "No transactions found in data"
- Ensure transaction data includes `transactionHistory.accountHistoryLines`
- Check that transactions have valid dates and amounts

### Issue: "MatplotlibDeprecationWarning"
- Update matplotlib to latest version
- These warnings can be safely ignored

### Issue: Images not saving
- Check `exports/visualizations/` directory exists
- Ensure write permissions on the directory
- Verify disk space is available

### Issue: Out of memory
- Process smaller date ranges
- Limit number of merchants displayed
- Clear old visualization files

## Support

For issues or questions:
1. Check error messages in backend logs
2. Verify transaction data format
3. Ensure all dependencies are installed
4. Check file permissions and disk space
