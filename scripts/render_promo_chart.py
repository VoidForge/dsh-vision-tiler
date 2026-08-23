from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ASSETS.mkdir(exist_ok=True)

labels = [
    "GPT-5.5",
    "GPT-5.6 Terra",
    "DeepSeek + Vision Tiler",
    "GPT-5.6 Luna",
    "DeepSeek direct",
]
f1 = [99.25, 98.67, 96.44, 94.99, 19.68]
latency = [27.95, 25.17, 6.08, 27.48, 6.87]

blue = "#2563EB"
orange = "#D97706"
gray = "#94A3B8"
ink = "#172033"
muted = "#64748B"
grid = "#E2E8F0"
colors = [gray, gray, blue, gray, orange]

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 11,
    "axes.titlesize": 13,
    "axes.titleweight": "bold",
    "text.color": ink,
    "axes.labelcolor": muted,
    "xtick.color": muted,
    "ytick.color": ink,
})

fig = plt.figure(figsize=(16, 9), facecolor="white")
grid_spec = fig.add_gridspec(
    2,
    2,
    width_ratios=[1.35, 1],
    height_ratios=[1, 1],
    left=0.17,
    right=0.97,
    top=0.82,
    bottom=0.13,
    wspace=0.42,
    hspace=0.48,
)
ax_f1 = fig.add_subplot(grid_spec[:, 0])
ax_latency = fig.add_subplot(grid_spec[0, 1])
ax_tokens = fig.add_subplot(grid_spec[1, 1])

fig.suptitle(
    "Dense-text benchmark: accuracy, latency, and token use",
    x=0.08,
    y=0.94,
    ha="left",
    fontsize=22,
    fontweight="bold",
    color=ink,
)
fig.text(
    0.08,
    0.885,
    "12 runs per configuration · DeepSeek Vision Tiler uses overview + overlapping full-coverage tiles",
    ha="left",
    fontsize=11.5,
    color=muted,
)

y = list(range(len(labels)))
bars = ax_f1.barh(y, f1, color=colors, edgecolor="white", height=0.62)
ax_f1.set_yticks(y, labels)
ax_f1.invert_yaxis()
ax_f1.set_xlim(0, 108)
ax_f1.set_title("Character-level F1 (%)", loc="left", pad=14)
ax_f1.set_xlabel("Higher is better")
ax_f1.grid(axis="x", color=grid, linewidth=0.8)
ax_f1.set_axisbelow(True)
for bar, value in zip(bars, f1):
    ax_f1.text(value + 1.2, bar.get_y() + bar.get_height() / 2, f"{value:.2f}", va="center", fontweight="bold")

latency_bars = ax_latency.barh(y, latency, color=colors, edgecolor="white", height=0.62)
ax_latency.set_yticks(y, ["GPT-5.5", "Terra", "Vision Tiler", "Luna", "DS direct"])
ax_latency.invert_yaxis()
ax_latency.set_xlim(0, 32)
ax_latency.set_title("Median latency (seconds)", loc="left", pad=10)
ax_latency.set_xlabel("Lower is better")
ax_latency.grid(axis="x", color=grid, linewidth=0.8)
ax_latency.set_axisbelow(True)
for bar, value in zip(latency_bars, latency):
    ax_latency.text(value + 0.5, bar.get_y() + bar.get_height() / 2, f"{value:.2f}s", va="center", fontsize=10, fontweight="bold")

token_labels = ["DeepSeek direct", "DeepSeek + Vision Tiler"]
token_values = [1136, 4971]
token_colors = [orange, blue]
token_y = list(range(len(token_labels)))
token_bars = ax_tokens.barh(token_y, token_values, color=token_colors, edgecolor="white", height=0.56)
ax_tokens.set_yticks(token_y, token_labels)
ax_tokens.invert_yaxis()
ax_tokens.set_xlim(0, 5600)
ax_tokens.set_title("Average tokens per run (DeepSeek)", loc="left", pad=10)
ax_tokens.set_xlabel("Higher accuracy uses more visual inputs")
ax_tokens.grid(axis="x", color=grid, linewidth=0.8)
ax_tokens.set_axisbelow(True)
for bar, value in zip(token_bars, token_values):
    ax_tokens.text(value + 100, bar.get_y() + bar.get_height() / 2, f"{value:,}", va="center", fontsize=10, fontweight="bold")

for ax in (ax_f1, ax_latency, ax_tokens):
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(grid)
    ax.tick_params(axis="y", length=0)

fig.text(
    0.08,
    0.055,
    "Source: repository benchmark matrices. Token accounting differs across model platforms; GPT token totals are intentionally omitted.",
    ha="left",
    fontsize=9.5,
    color=muted,
)

for extension in ("png", "svg"):
    fig.savefig(ASSETS / f"benchmark-comparison.{extension}", dpi=180, facecolor="white")

plt.close(fig)
