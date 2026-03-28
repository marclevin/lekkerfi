"""
Generates financial insight visualizations from transaction data.
Creates charts, graphs, and visual summaries of spending patterns.
Supports both static images and interactive JSON data.
"""

import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import matplotlib
matplotlib.use('Agg')  # non-interactive backend safe for use in Flask threads
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.patches import Patch
import numpy as np

# Try to import plotly, but make it optional
try:
    import plotly.graph_objects as go
    import plotly.express as px
    PLOTLY_AVAILABLE = True
except ImportError:
    PLOTLY_AVAILABLE = False


class FinancialInsightsVisualizer:
    """Generate visualizations from transaction data."""
    
    def __init__(self, output_dir: str | None = None):
        """
        Initialize the visualizer.
        
        Args:
            output_dir: Directory to save visualization images.
                       Defaults to 'exports/visualizations/'
        """
        if output_dir is None:
            output_dir = str(Path(__file__).resolve().parent.parent / "exports" / "visualizations")
        
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Set up matplotlib style
        plt.style.use("seaborn-v0_8-darkgrid")
        self.colors = plt.cm.Set3(np.linspace(0, 1, 12))
    
    def generate_all_insights(self, transaction_data: dict) -> dict:
        """
        Generate all available financial insights visualizations.
        
        Args:
            transaction_data: Transaction data dict with 'transactionHistory' key
        
        Returns:
            dict with keys:
            - visualizations: List of generated visualization metadata
            - summary: Financial summary statistics
            - charts_json: Interactive chart data (if plotly available)
        """
        trx_history = transaction_data.get("transactionHistory", {})
        transactions = trx_history.get("accountHistoryLines", [])
        
        if not transactions:
            raise ValueError("No transactions found in data")
        
        # Parse and organize transactions
        parsed_trx = self._parse_transactions(transactions)
        
        # Generate visualizations
        visualizations = []
        
        # 1. Spending Overview (Income vs Expenses)
        viz = self._create_spending_overview(parsed_trx)
        visualizations.append(viz)
        
        # 2. Spending by Category/Merchant
        viz = self._create_category_breakdown(parsed_trx)
        visualizations.append(viz)
        
        # 3. Daily Spending Trend
        viz = self._create_daily_trend(parsed_trx)
        visualizations.append(viz)
        
        # 4. Balance Over Time
        viz = self._create_balance_progression(trx_history, parsed_trx)
        visualizations.append(viz)
        
        # 5. Top Transactions
        viz = self._create_top_transactions_chart(parsed_trx)
        visualizations.append(viz)
        
        # 6. Cumulative Spending
        viz = self._create_cumulative_spending(parsed_trx)
        visualizations.append(viz)
        
        # Generate summary statistics
        summary = self._generate_summary_statistics(trx_history, parsed_trx)
        
        # Generate interactive charts if plotly available
        charts_json = {}
        if PLOTLY_AVAILABLE:
            charts_json = self._generate_interactive_charts(parsed_trx)
        
        return {
            "generated_at": datetime.now().isoformat(),
            "transaction_count": len(transactions),
            "visualizations": visualizations,
            "summary": summary,
            "charts_json": charts_json,
        }
    
    def _parse_transactions(self, transactions: list) -> dict:
        """Parse and organize transactions for analysis."""
        parsed = {
            "by_date": {},
            "all": [],
            "income": [],
            "expenses": [],
            "by_merchant": {},
        }
        
        for trx in transactions:
            try:
                date_str = trx.get("transactionDate", "")
                amount_str = trx.get("transactionAmount", "0")
                description = trx.get("transactionDescription", "Unknown")
                
                # Parse amount
                amount = self._parse_amount(amount_str)
                
                # Parse date
                date_obj = self._parse_date(date_str)
                date_key = date_obj.strftime("%Y-%m-%d")
                
                # Categorize
                parsed_trx_item = {
                    "date": date_obj,
                    "date_str": date_key,
                    "amount": amount,
                    "description": description,
                    "is_credit": amount > 0,
                }
                
                parsed["all"].append(parsed_trx_item)
                
                if amount > 0:
                    parsed["income"].append(parsed_trx_item)
                else:
                    parsed["expenses"].append(parsed_trx_item)
                
                # By date
                if date_key not in parsed["by_date"]:
                    parsed["by_date"][date_key] = []
                parsed["by_date"][date_key].append(parsed_trx_item)
                
                # By merchant (extract from description)
                merchant = self._extract_merchant(description)
                if merchant not in parsed["by_merchant"]:
                    parsed["by_merchant"][merchant] = {"count": 0, "total": 0, "transactions": []}
                parsed["by_merchant"][merchant]["count"] += 1
                parsed["by_merchant"][merchant]["total"] += amount
                parsed["by_merchant"][merchant]["transactions"].append(parsed_trx_item)
                
            except Exception as e:
                print(f"Error parsing transaction: {trx}, {e}")
                continue
        
        return parsed
    
    def _create_spending_overview(self, parsed_trx: dict) -> dict:
        """Create income vs expenses overview chart."""
        income = sum(t["amount"] for t in parsed_trx["income"])
        expenses = sum(abs(t["amount"]) for t in parsed_trx["expenses"])
        net = income - expenses
        
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))
        
        # Bar chart
        categories = ["Income", "Expenses", "Net"]
        values = [income, expenses, net]
        colors_bar = ["green" if v > 0 else "red" for v in values]
        
        bars = ax1.bar(categories, values, color=colors_bar, alpha=0.7, edgecolor="black")
        ax1.set_ylabel("Amount (R)", fontsize=12, fontweight="bold")
        ax1.set_title("Spending Overview", fontsize=14, fontweight="bold")
        ax1.axhline(y=0, color="black", linestyle="-", linewidth=0.5)
        ax1.grid(axis="y", alpha=0.3)
        
        # Add values on bars
        for bar, value in zip(bars, values):
            height = bar.get_height()
            ax1.text(
                bar.get_x() + bar.get_width() / 2,
                height,
                f"R{height:,.2f}",
                ha="center",
                va="bottom" if height > 0 else "top",
                fontsize=10,
                fontweight="bold",
            )
        
        # Pie chart
        sizes = [income, expenses]
        labels_pie = [f"Income\nR{income:,.0f}", f"Expenses\nR{expenses:,.0f}"]
        colors_pie = ["green", "red"]
        
        wedges, texts, autotexts = ax2.pie(
            sizes,
            labels=labels_pie,
            colors=colors_pie,
            autopct="%1.1f%%",
            startangle=90,
            textprops={"fontsize": 11, "fontweight": "bold"},
        )
        ax2.set_title("Income vs Expenses Distribution", fontsize=14, fontweight="bold")
        
        plt.tight_layout()
        
        # Save visualization
        filename = f"spending_overview_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
        filepath = self.output_dir / filename
        plt.savefig(filepath, dpi=150, bbox_inches="tight")
        plt.close()
        
        return {
            "type": "spending_overview",
            "title": "Spending Overview",
            "description": f"Income: R{income:,.2f} | Expenses: R{expenses:,.2f} | Net: R{net:,.2f}",
            "file": str(filepath),
            "filename": filename,
            "data": {
                "income": round(income, 2),
                "expenses": round(expenses, 2),
                "net": round(net, 2),
            },
        }
    
    def _create_category_breakdown(self, parsed_trx: dict) -> dict:
        """Create spending breakdown by merchant/category."""
        # Get top merchants by spending
        merchant_data = parsed_trx["by_merchant"]
        top_merchants = sorted(
            merchant_data.items(),
            key=lambda x: abs(x[1]["total"]),
            reverse=True,
        )[:10]
        
        merchants, amounts = zip(*[(m[0], abs(m[1]["total"])) for m in top_merchants])
        
        fig, ax = plt.subplots(figsize=(12, 8))
        
        bars = ax.barh(merchants, amounts, color=self.colors[: len(merchants)], edgecolor="black")
        ax.set_xlabel("Amount Spent (R)", fontsize=12, fontweight="bold")
        ax.set_title("Top 10 Spending Categories/Merchants", fontsize=14, fontweight="bold")
        ax.invert_yaxis()
        
        # Add values on bars
        for i, (bar, amount) in enumerate(zip(bars, amounts)):
            ax.text(
                amount,
                bar.get_y() + bar.get_height() / 2,
                f" R{amount:,.0f}",
                va="center",
                fontsize=10,
                fontweight="bold",
            )
        
        plt.tight_layout()
        
        filename = f"category_breakdown_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
        filepath = self.output_dir / filename
        plt.savefig(filepath, dpi=150, bbox_inches="tight")
        plt.close()
        
        return {
            "type": "category_breakdown",
            "title": "Spending by Category/Merchant",
            "description": f"Top 10 spending categories out of {len(merchant_data)} total",
            "file": str(filepath),
            "filename": filename,
            "data": {
                "merchants": {name: round(abs(amount), 2) for name, amount in zip(merchants, amounts)}
            },
        }
    
    def _create_daily_trend(self, parsed_trx: dict) -> dict:
        """Create daily spending trend chart."""
        by_date = parsed_trx["by_date"]
        dates = sorted(by_date.keys())
        
        daily_expense = []
        daily_income = []
        
        for date in dates:
            expenses = sum(abs(t["amount"]) for t in by_date[date] if t["amount"] < 0)
            income = sum(t["amount"] for t in by_date[date] if t["amount"] > 0)
            daily_expense.append(expenses)
            daily_income.append(income)
        
        date_objs = [self._parse_date(d) for d in dates]
        
        fig, ax = plt.subplots(figsize=(14, 6))
        
        ax.plot(date_objs, daily_income, marker="o", label="Income", color="green", linewidth=2, markersize=4)
        ax.plot(date_objs, daily_expense, marker="s", label="Expenses", color="red", linewidth=2, markersize=4)
        ax.fill_between(date_objs, daily_income, alpha=0.2, color="green")
        ax.fill_between(date_objs, daily_expense, alpha=0.2, color="red")
        
        ax.set_xlabel("Date", fontsize=12, fontweight="bold")
        ax.set_ylabel("Amount (R)", fontsize=12, fontweight="bold")
        ax.set_title("Daily Income and Spending Trend", fontsize=14, fontweight="bold")
        ax.legend(fontsize=11, loc="upper left")
        ax.grid(True, alpha=0.3)
        ax.xaxis.set_major_locator(mdates.AutoDateLocator())
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m-%d"))
        plt.xticks(rotation=45, ha="right")
        
        plt.tight_layout()
        
        filename = f"daily_trend_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
        filepath = self.output_dir / filename
        plt.savefig(filepath, dpi=150, bbox_inches="tight")
        plt.close()
        
        return {
            "type": "daily_trend",
            "title": "Daily Spending Trend",
            "description": f"Trend from {dates[0]} to {dates[-1]}",
            "file": str(filepath),
            "filename": filename,
            "data": {
                "dates": dates,
                "daily_income": [round(x, 2) for x in daily_income],
                "daily_expense": [round(x, 2) for x in daily_expense],
            },
        }
    
    def _create_balance_progression(self, trx_history: dict, parsed_trx: dict) -> dict:
        """Create balance over time chart."""
        sorted_trx = sorted(parsed_trx["all"], key=lambda x: x["date"])
        starting_balance = self._parse_amount(trx_history.get("currentBalance", "0"))
        
        cumulative = []
        balance = starting_balance
        dates = []
        
        # Work backwards to get starting balance
        for trx in reversed(sorted_trx):
            balance -= trx["amount"]
        
        # Now go forward
        for trx in sorted_trx:
            balance += trx["amount"]
            cumulative.append(balance)
            dates.append(trx["date"])
        
        fig, ax = plt.subplots(figsize=(14, 6))
        
        ax.plot(dates, cumulative, marker="o", color="blue", linewidth=2.5, markersize=4, label="Balance")
        ax.fill_between(dates, cumulative, alpha=0.2, color="blue")
        
        ax.set_xlabel("Date", fontsize=12, fontweight="bold")
        ax.set_ylabel("Balance (R)", fontsize=12, fontweight="bold")
        ax.set_title("Account Balance Over Time", fontsize=14, fontweight="bold")
        ax.grid(True, alpha=0.3)
        ax.xaxis.set_major_locator(mdates.AutoDateLocator())
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m-%d"))
        plt.xticks(rotation=45, ha="right")
        
        # Add legend
        ax.legend(fontsize=11)
        
        plt.tight_layout()
        
        filename = f"balance_progression_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
        filepath = self.output_dir / filename
        plt.savefig(filepath, dpi=150, bbox_inches="tight")
        plt.close()
        
        min_balance = min(cumulative)
        max_balance = max(cumulative)
        
        return {
            "type": "balance_progression",
            "title": "Balance Over Time",
            "description": f"Balance range: R{min_balance:,.2f} to R{max_balance:,.2f}",
            "file": str(filepath),
            "filename": filename,
            "data": {
                "dates": [d.strftime("%Y-%m-%d") for d in dates],
                "balances": [round(x, 2) for x in cumulative],
                "min_balance": round(min_balance, 2),
                "max_balance": round(max_balance, 2),
                "final_balance": round(cumulative[-1], 2) if cumulative else 0,
            },
        }
    
    def _create_top_transactions_chart(self, parsed_trx: dict) -> dict:
        """Create chart of largest transactions."""
        all_trx = sorted(parsed_trx["all"], key=lambda x: abs(x["amount"]), reverse=True)[:10]
        
        descriptions = [t["description"][:20] for t in all_trx]
        amounts = [t["amount"] for t in all_trx]
        colors_bar = ["green" if a > 0 else "red" for a in amounts]
        
        fig, ax = plt.subplots(figsize=(12, 8))
        
        bars = ax.barh(descriptions, amounts, color=colors_bar, alpha=0.7, edgecolor="black")
        ax.set_xlabel("Amount (R)", fontsize=12, fontweight="bold")
        ax.set_title("Top 10 Largest Transactions", fontsize=14, fontweight="bold")
        ax.axvline(x=0, color="black", linestyle="-", linewidth=0.5)
        ax.invert_yaxis()
        
        # Add values on bars
        for bar, amount in zip(bars, amounts):
            x_pos = amount
            ax.text(
                x_pos,
                bar.get_y() + bar.get_height() / 2,
                f" R{amount:,.0f}",
                va="center",
                ha="left" if amount > 0 else "right",
                fontsize=10,
                fontweight="bold",
            )
        
        plt.tight_layout()
        
        filename = f"top_transactions_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
        filepath = self.output_dir / filename
        plt.savefig(filepath, dpi=150, bbox_inches="tight")
        plt.close()
        
        return {
            "type": "top_transactions",
            "title": "Top 10 Largest Transactions",
            "description": "Includes both income and expenses",
            "file": str(filepath),
            "filename": filename,
            "data": {
                "transactions": [
                    {
                        "description": t["description"],
                        "amount": round(t["amount"], 2),
                        "date": t["date_str"],
                    }
                    for t in all_trx
                ]
            },
        }
    
    def _create_cumulative_spending(self, parsed_trx: dict) -> dict:
        """Create cumulative spending chart."""
        sorted_trx = sorted(parsed_trx["expenses"], key=lambda x: x["date"])
        
        cumulative = []
        total = 0
        dates = []
        
        for trx in sorted_trx:
            total += abs(trx["amount"])
            cumulative.append(total)
            dates.append(trx["date"])
        
        fig, ax = plt.subplots(figsize=(14, 6))
        
        ax.plot(dates, cumulative, marker="o", color="darkred", linewidth=2.5, markersize=4)
        ax.fill_between(dates, cumulative, alpha=0.3, color="red")
        
        ax.set_xlabel("Date", fontsize=12, fontweight="bold")
        ax.set_ylabel("Cumulative Spending (R)", fontsize=12, fontweight="bold")
        ax.set_title("Cumulative Spending Over Time", fontsize=14, fontweight="bold")
        ax.grid(True, alpha=0.3)
        ax.xaxis.set_major_locator(mdates.AutoDateLocator())
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m-%d"))
        plt.xticks(rotation=45, ha="right")
        
        plt.tight_layout()
        
        filename = f"cumulative_spending_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
        filepath = self.output_dir / filename
        plt.savefig(filepath, dpi=150, bbox_inches="tight")
        plt.close()
        
        return {
            "type": "cumulative_spending",
            "title": "Cumulative Spending",
            "description": f"Total spending: R{total:,.2f}",
            "file": str(filepath),
            "filename": filename,
            "data": {
                "dates": [d.strftime("%Y-%m-%d") for d in dates],
                "cumulative": [round(x, 2) for x in cumulative],
                "total": round(total, 2),
            },
        }
    
    def _generate_interactive_charts(self, parsed_trx: dict) -> dict:
        """Generate interactive plotly charts."""
        charts = {}
        
        # Spending overview pie
        income = sum(t["amount"] for t in parsed_trx["income"])
        expenses = sum(abs(t["amount"]) for t in parsed_trx["expenses"])
        
        fig = go.Figure(
            data=[
                go.Pie(
                    labels=["Income", "Expenses"],
                    values=[income, expenses],
                    marker=dict(colors=["green", "red"]),
                )
            ],
            layout=go.Layout(title="Income vs Expenses"),
        )
        charts["spending_overview_pie"] = json.loads(fig.to_json())
        
        # Category breakdown
        merchant_data = parsed_trx["by_merchant"]
        top_merchants = sorted(
            merchant_data.items(),
            key=lambda x: abs(x[1]["total"]),
            reverse=True,
        )[:10]
        
        fig = go.Figure(
            data=[
                go.Bar(
                    x=[abs(m[1]["total"]) for m in top_merchants],
                    y=[m[0] for m in top_merchants],
                    orientation="h",
                    marker=dict(color="indianred"),
                )
            ],
            layout=go.Layout(
                title="Top 10 Spending Categories",
                xaxis_title="Amount (R)",
            ),
        )
        charts["category_breakdown_bar"] = json.loads(fig.to_json())
        
        return charts
    
    def _generate_summary_statistics(self, trx_history: dict, parsed_trx: dict) -> dict:
        """Generate summary statistics."""
        transactions = parsed_trx["all"]
        income = sum(t["amount"] for t in parsed_trx["income"])
        expenses = sum(abs(t["amount"]) for t in parsed_trx["expenses"])
        
        if transactions:
            avg_transaction = sum(abs(t["amount"]) for t in transactions) / len(transactions)
            largest_income = max((t["amount"] for t in parsed_trx["income"]), default=0)
            largest_expense = min((t["amount"] for t in parsed_trx["expenses"]), default=0)
        else:
            avg_transaction = 0
            largest_income = 0
            largest_expense = 0
        
        return {
            "total_transactions": len(transactions),
            "total_income": round(income, 2),
            "total_expenses": round(expenses, 2),
            "net_flow": round(income - expenses, 2),
            "average_transaction": round(avg_transaction, 2),
            "largest_income": round(largest_income, 2),
            "largest_expense": round(largest_expense, 2),
            "account_balance": round(self._parse_amount(trx_history.get("currentBalance", "0")), 2),
            "available_balance": round(self._parse_amount(trx_history.get("availableBalance", "0")), 2),
            "transaction_count_income": len(parsed_trx["income"]),
            "transaction_count_expenses": len(parsed_trx["expenses"]),
            "number_of_merchants": len(parsed_trx["by_merchant"]),
        }
    
    @staticmethod
    def _parse_amount(amount_str: str) -> float:
        """Parse amount string to float."""
        if not amount_str or isinstance(amount_str, (int, float)):
            return 0.0
        
        amount_str = str(amount_str).replace("R", "").replace(",", "").strip()
        try:
            return float(amount_str)
        except ValueError:
            return 0.0
    
    @staticmethod
    def _parse_date(date_str: str) -> datetime:
        """Parse date string to datetime object."""
        if not date_str:
            return datetime.now()
        
        date_str = date_str.strip()
        
        formats = [
            "%Y-%m-%d %H:%M",
            "%Y-%m-%d",
            "%d-%m-%Y",
            "%m/%d/%Y",
            "%Y/%m/%d",
            "%d/%m/%Y",
        ]
        
        for fmt in formats:
            try:
                return datetime.strptime(date_str.split()[0], fmt)
            except ValueError:
                continue
        
        return datetime.now()
    
    @staticmethod
    def _extract_merchant(description: str) -> str:
        """Extract merchant name from transaction description."""
        if not description:
            return "Unknown"
        
        # Remove common prefixes
        prefixes = ["Trf to", "Dep.", "Debit Order", "Cheque"]
        for prefix in prefixes:
            if description.startswith(prefix):
                desc = description[len(prefix):].strip()
                break
        else:
            desc = description
        
        # Take first meaningful portion
        parts = desc.split()
        if parts:
            return " ".join(parts[:2])  # Return first 1-2 words
        
        return description[:20]
