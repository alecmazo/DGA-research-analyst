"""The fifty rules used on the Munger page and in Grok section 8.5.

Titles name the rule. The third field is one sentence on how to apply it
to a holding. Reports cite them as ``Rule 13 — ...``.
"""

RULES: tuple[tuple[int, str, str], ...] = (
    (1, "Incentives rule everything", "Name who is paid if this works and who is paid if it fails."),
    (2, "Invert, always invert", "Write the path that wipes the investment out, then see if you still own it."),
    (3, "Latticework of mental models", "Use more than one field. A single ratio is not a reason."),
    (4, "Circle of competence", "Say what you actually understand about this business, and what you do not."),
    (5, "Avoid stupidity before seeking brilliance", "The miss that matters is a permanent loss, not a missed rally."),
    (6, "The money is in the waiting", "The return has to come from the business, not from trading the quote."),
    (7, "A great business at a fair price", "A cheap price does not fix a poor business. A fair price can still be right."),
    (8, "Deserve what you want", "If you cannot explain the holding, you have not earned the opinion."),
    (9, "Few big bets", "This only belongs in size if the odds are plainly in your favor."),
    (10, "The Lollapalooza effect", "Several forces in the same direction matter more than any one of them."),
    (11, "Never interrupt compounding", "Fees, taxes, and restless turnover are the leak."),
    (12, "A web of deserved trust", "The people who run this have to be trustable. Rules will not replace that."),
    (13, "Avoid leverage that can wipe you out", "Debt and leases that cannot be paid in a bad year are the risk."),
    (14, "Earn the right to an opinion", "Do not hold a view you cannot defend better than the other side."),
    (15, "Kill your best-loved ideas", "Look for the fact that would make you sell this."),
    (16, "Opportunity cost is the real filter", "Compare this with the best other use of the same dollar."),
    (17, "Use checklists", "Walk the same short list every time, including this name."),
    (18, "Be a learning machine", "What changed since the last report, and did you update the view?"),
    (19, "Patience, then decisive action", "Waiting is correct until the pitch is obvious. Then size it."),
    (20, "Avoid envy and self-pity", "Someone else's gain is not a reason to own this."),
    (21, "Take simple ideas seriously", "The plain point — cash, debt, price — is usually the point."),
    (22, "The too-hard pile", "If you cannot underwrite it, it does not get capital."),
    (23, "Man with a hammer", "Do not force this name into the one model you like."),
    (24, "Beware social proof", "A crowded view is not evidence."),
    (25, "Commitment and consistency", "You will defend the old write-up. Read it as if someone else wrote it."),
    (26, "Durable moats", "What stops a competitor from copying the profit?"),
    (27, "Management integrity matters", "You cannot fix a deal with people who are not straight."),
    (28, "The first dollar is the hardest", "Small positions still have to clear the same quality bar."),
    (29, "The basic formula", "Spend less than it earns, reinvest well, and avoid the toxic."),
    (30, "Choose partners carefully", "Co-investors, lenders, and the board shape the outcome."),
    (31, "Remove low-quality people", "A weak operator costs more than they add."),
    (32, "Face trouble with equanimity", "A drawdown is not a reason to abandon the work."),
    (33, "Expect large drawdowns", "If you cannot hold through a deep decline, the size is wrong."),
    (34, "Simplicity wins", "If the story needs complexity, the idea is probably weak."),
    (35, "Economics over accounting", "Prefer cash and the real obligation over the adjusted number."),
    (36, "Distrust forecasts", "A precise target is not a fact. Start from what is already true."),
    (37, "Shoe-button complex", "Skill in one business is not skill in this one."),
    (38, "Discount conflicted advice", "Ask what the source is paid to say."),
    (39, "Think in probabilities", "A base rate first, then the specific evidence."),
    (40, "Find mispriced bets", "You are paid for being right when the price is wrong, not for activity."),
    (41, "Wisdom accumulates slowly", "One report does not make you an expert on this company."),
    (42, "Rationality is a duty", "The job is to see it clearly, including the part you dislike."),
    (43, "Avoid ideology", "A label — growth, value, AI — is not an argument."),
    (44, "Defer gratification", "The payoff that requires waiting is often the one that is real."),
    (45, "Know the edge of your competence", "Write down where your knowledge of this name stops."),
    (46, "Know where you would die", "Name the failure that ends the investment, and stay away from it."),
    (47, "When you find a good idea, act big", "A rare and obvious holding should not be a token weight."),
    (48, "Long-run returns track the business", "Over time you get roughly what the assets earn."),
    (49, "It is not supposed to be easy", "Difficulty is normal. That is not a reason to quit the work."),
    (50, "Live so the end is respectable", "Integrity and humor outlast the quote."),
)


def prompt_list() -> str:
    return "\n".join(f"{n}. {title}" for n, title, _apply in RULES)
