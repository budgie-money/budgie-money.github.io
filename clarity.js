/* Everyday budgeting: categories first; activity and account balances have separate views. */
(function () {
  "use strict";
  window.BudgieClarity = {
    install: function (A, originals) {
      var B = A.B,
        S = A.S,
        V = A.SCREENS,
        ACT = A.ACT,
        E = A.esc,
        M = A.M,
        card = A.card;
      var db = A.db,
        me = A.me,
        now = A.today,
        go = A.go,
        render = A.render;
      function button(label, action, value, cls) {
        return (
          '<button type="button" class="btn ' +
          (cls || "") +
          '" data-a="' +
          action +
          '"' +
          (value !== undefined ? ' data-v="' + E(value) + '"' : "") +
          ">" +
          E(label) +
          "</button>"
        );
      }
      var style = document.createElement("style");
      style.textContent =
        ".c-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-bottom:18px}.c-tabs button{padding:11px 3px;min-width:0;font-size:14px;white-space:nowrap}.c-tabs [aria-pressed=true]{background:var(--accent);color:var(--accent-ink)}.c-period{display:grid;grid-template-columns:42px 1fr 42px;gap:6px;align-items:center;margin:8px 0 18px;text-align:center}.c-period strong,.c-period small{display:block}.c-period small{font-size:12px;color:var(--muted);margin-top:3px;line-height:1.5}.c-budget-head,.c-budget-row{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr);gap:8px;align-items:center;text-align:right}.c-budget-head{font-size:12px;color:var(--muted);padding:8px 0}.c-budget-head>:first-child,.c-budget-row>:first-child{text-align:left}.c-budget-row{width:100%;background:none;color:inherit;border:0;border-top:1px solid var(--line2);padding:15px 0;font:inherit}.c-budget-row strong{font-size:15px;line-height:1.35;display:block;overflow-wrap:anywhere}.c-budget-row small{display:block;font-size:11px;color:var(--muted);margin-top:4px}.c-budget-row .c-amount{font-size:15px;font-weight:750;font-variant-numeric:tabular-nums;white-space:nowrap}.c-over{color:var(--warn)}.c-guide{display:block;width:100%;border:0;text-align:left;color:var(--accent-ink);padding:20px}.c-guide .big{font-size:38px;line-height:1.2;margin:5px 0 15px}.c-guide-parts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;border-top:1px solid rgba(255,255,255,.25);padding-top:13px}.c-guide-parts span,.c-guide-parts b{display:block;font-size:12px;line-height:1.5}.c-guide-parts span{opacity:.85;overflow-wrap:anywhere}.c-guide-parts b{font-size:15px}.c-action{border-bottom:1px solid var(--line2);padding:14px 0}.c-action:last-child{border:0}.c-action strong{display:block;font-size:15px;line-height:1.45}.c-action .btn{margin-top:9px}.c-section{margin:20px 2px 10px;font-size:15px;color:var(--muted)}.c-date{margin:18px 0 4px;font-size:13px;font-weight:700;color:var(--muted)}.c-activity .li{align-items:center}.c-activity .what{line-height:1.4}.c-activity .rt{flex-shrink:0;margin-left:6px}.c-guide-sheet .li{align-items:center}.c-actions-empty{margin:0;color:var(--muted);font-size:13px}.c-quick{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}.c-quick button{padding-left:5px;padding-right:5px;font-size:13px;white-space:nowrap}.c-activity-switch{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}.c-activity-switch button{font-size:13px;padding:9px 4px;white-space:nowrap}";
      document.head.appendChild(style);
      style.textContent += ".c-activity .li,.c-guide-sheet .li{align-items:flex-start}.c-budget-row{align-items:start}.c-budget-row strong,.c-budget-row .c-amount{font-size:1em;line-height:1.4}.c-budget-row .c-amount{display:block;font-size:clamp(14px,4.8vw,1em)}.c-budget-row small{line-height:1.4;min-height:1.4em}.c-guide{color:var(--hero-ink);background:var(--hero);position:relative}.c-guide-top{display:flex;justify-content:space-between;align-items:center;gap:12px}.c-guide-top>span{font-size:13px;font-weight:700}.c-guide-link{border:1px solid color-mix(in srgb,var(--hero-ink) 35%,transparent);border-radius:20px;padding:6px 10px;font-size:11px!important}.c-guide-total{display:flex;align-items:baseline;gap:9px;margin:10px 0 16px}.c-guide-total .big{margin:0;font-size:40px}.c-guide-total .small{font-size:13px;opacity:.9}.c-guide-parts{border-color:color-mix(in srgb,var(--hero-ink) 25%,transparent);align-items:stretch}.c-guide-parts>div{display:flex;flex-direction:column;justify-content:space-between;gap:7px}.c-guide-parts span{opacity:1;min-height:3em}.c-guide-parts b{line-height:1.4}.c-guide-until{font-size:12px;margin-top:10px;opacity:.9}.c-choice-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:18px 0}.c-choice-grid .btn{min-width:0;font-size:13px;padding:12px 8px;white-space:normal}.c-choice-list{display:grid;gap:10px}.c-partner-overview{display:grid;gap:0}.c-partner-overview .li{align-items:start}.c-partner-overview .num{line-height:1.4}.c-budget-caption{font-size:12px;color:var(--muted);margin:10px 0 0;line-height:1.5}";
      style.textContent += ".c-guide{padding:18px}.c-guide-top{margin-bottom:14px}.c-guide-link{border:0;padding:0;font-size:12px!important}.c-guide-main{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:18px}.c-guide-total{display:block;margin:0}.c-guide-total .big{font-size:42px;line-height:1.15;letter-spacing:-1.2px}.c-guide-total .small{display:block;margin-top:4px;font-size:13px;opacity:1}.c-guide-payday{display:grid;grid-template-columns:24px auto;align-items:center;column-gap:8px;text-align:left}.c-guide-payday svg{grid-row:1/4}.c-guide-payday span{display:block;font-size:11px;line-height:1.5}.c-guide-payday strong{display:block;font-size:14px;line-height:1.5}.c-guide-parts{border:0;padding:0;gap:8px}.c-guide-parts>div{display:grid;grid-template-rows:minmax(34px,auto) auto minmax(28px,auto) 4px;align-content:start;justify-content:normal;gap:7px;background:color-mix(in srgb,var(--hero-ink) 4%,var(--hero));border:1px solid color-mix(in srgb,var(--hero-ink) 18%,transparent);border-radius:12px;padding:11px 9px}.c-guide-parts>div.is-active{border-color:color-mix(in srgb,var(--hero-ink) 65%,transparent)}.c-guide-parts>div.is-over{border-style:dashed}.c-guide-parts .c-guide-icon{height:24px;min-height:0;display:flex;align-items:center}.c-guide-parts .c-guide-name{font-size:12px;font-weight:650;line-height:1.4;min-height:0}.c-guide-parts b{font-size:clamp(14px,4.6vw,18px);line-height:1.3;white-space:nowrap;align-self:start}.c-guide-parts .c-guide-state{font-size:10px;line-height:1.4;min-height:0;align-self:start}.c-guide-parts .c-guide-meter{height:4px;min-height:0;border-radius:3px;background:color-mix(in srgb,var(--hero-ink) 14%,transparent);overflow:hidden;align-self:end}.c-guide-meter i{display:block;height:100%;background:currentColor;border-radius:3px}.c-guide-context{display:flex;align-items:center;gap:6px;margin-top:13px;font-size:12px;line-height:1.5}.c-guide-context svg{flex:none}.c-guide-context span{min-width:0}@media(max-width:340px){.c-guide{padding:15px}.c-guide-main{gap:8px}.c-guide-total .big{font-size:36px}.c-guide-payday{column-gap:5px;grid-template-columns:19px auto}.c-guide-payday strong{font-size:12px}.c-guide-parts{gap:6px}.c-guide-parts>div{padding:10px 7px}.c-guide-parts .c-guide-name{font-size:11px}}";
      style.textContent += ".c-guide-parts .c-guide-category{display:flex;align-items:center;gap:5px;min-height:34px}.c-guide-parts .c-guide-icon{flex:none;width:21px}.c-guide-parts .c-guide-state{min-height:28px}.c-guide-parts .c-guide-name{min-width:0}@supports(grid-template-rows:subgrid){.c-guide-parts>div{grid-row:span 4;grid-template-rows:subgrid}}";
      A.TITLES.money = function () {
        return ["Money", ""];
      };
      A.TITLES.plan = function () {
        return ["Budget", ""];
      };
      A.TITLES.spare = function () {
        return ["Saving rules", ""];
      };
      function selectedPeriod() {
        var d = db(),
          per = B.periodAt(d, me(), now()),
          off = +S.ui.monthOff || 0;
        for (var i = 0; i < Math.abs(off); i++)
          per =
            off > 0 ? B.nextPeriod(d, me(), per) : B.prevPeriod(d, me(), per);
        return per;
      }
      function periodHeading(per) {
        return (
          '<div class="c-period">' +
          button("‹", "month", "-1", "ghost sm") +
          "<div><strong>" +
          E(per.name) +
          "</strong><small>" +
          E(B.nice(per.start)) +
          "<br>to " +
          E(B.nice(B.addDays(per.next, -1))) +
          "</small></div>" +
          button("›", "month", "1", "ghost sm") +
          "</div>"
        );
      }
      function categories(per) {
        var states = B.budgetState(db(), me(), per);
        return Object.keys(states)
          .map(function (id) {
            var s = states[id];
            return {
              id: id,
              name: s.budget.name,
              amount: s.avail,
              spent: s.spent,
              left: s.left,
              mode: s.budget.mode,
              current: s.current,
            };
          })
          .filter(function (t) {
            return t.current && t.mode !== "saving";
          });
      }
      function budgetTable(rows, per, partner) {
        return (
          '<div class="c-budget-head"><span>Budget</span><span>Spent</span><span>Left</span></div>' +
          rows
            .map(function (t) {
              var tag = partner ? "div" : "button",
                left = isFinite(t.left) ? +t.left : B.round((+t.amount || 0) - (+t.spent || 0)),
                over = left < -0.004;
              return (
                "<" +
                tag +
                (partner
                  ? ""
                  : ' type="button" data-a="payments" data-v="' +
                    E(per.start + "|" + t.id) +
                    '"') +
                ' class="c-budget-row"><span><strong>' +
                E(t.name.replace(/ \(what\x27s left\)/, "")) +
                "</strong><small>" +
                M(t.amount) +
                ' budget</small></span><span class="c-amount">' +
                M(t.spent) +
                '</span><span class="c-amount ' +
                (over ? "c-over" : "") +
                '">' +
                M(Math.abs(left)) +
                (over ? '<small class="c-over">over</small>' : '<small aria-hidden="true">&nbsp;</small>') +
                "</span></" +
                tag +
                ">"
              );
            })
            .join("")
        );
      }
      function guideParts(t) {
        var list = t.tiles.filter(function (x) {
            return x.day !== null && x.mode !== "saving";
          }),
          total = list.reduce(function (n, x) {
            return n + Math.max(0, x.left);
          }, 0),
          used = 0,
          lastFunded = list.reduce(function (last, x, i) { return x.left > 0.004 ? i : last; }, -1);
        return list.map(function (x, i) {
          var a =
            x.left <= 0.004 ? 0 : i === lastFunded
              ? B.round(Math.max(0, t.safe - used))
              : B.round(total ? (Math.max(0, x.left) / total) * t.safe : 0);
          a = Math.min(a, Math.max(0, B.round(t.safe - used)));
          used = B.round(used + a);
          return { name: x.name, left: x.left, amount: a, limit: x.amount };
        });
      }
      ACT.herosheet = function () {
        var t = B.today(db(), me(), now());
        A.openSheet(
          '<h2>Daily guide</h2><div class="c-guide-sheet list">' +
            guideParts(t)
              .map(function (x) {
                return A.li(
                  E(x.name),
                  x.left < -0.004 ? M(-x.left) + " over budget" : M(Math.max(0, x.left)) + " left until payday",
                  A.num(M(x.amount) + " / day"),
                );
              })
              .join("") +
            '</div><p class="small muted">A guide for pacing these budgets until payday. Spending is still deducted from its own category.</p>' +
            button("Got it", "sheetclose", undefined, "wide"),
        );
      };
      function feasibleActions(t) {
        var balance = B.balances(db(), now()),
          available = {},
          rows = [];
        t.todo
          .filter(function (x) {
            return !x.payday;
          })
          .concat(B.spareMoney(db(), me(), now()).moves)
          .forEach(function (item) {
            var it = Object.assign({}, item);
            if (it.type === "move") {
              if (it.waiting) return;
              if (available[it.from] === undefined)
                available[it.from] = Math.max(0, balance[it.from] || 0);
              var amount = B.round(
                Math.min(
                  it.amount,
                  available[it.from],
                  Math.max(0, it.amount - (+it.short || 0)),
                ),
              );
              if (amount < 0.005) return;
              // Partial reimbursement is useful; never mark its unfunded remainder done.
              var remaining = amount;
              it.keys = (it.keys || [{ key: it.key, amount: it.amount }])
                .map(function (k) {
                  var a = B.round(Math.min(remaining, k.amount));
                  remaining = B.round(remaining - a);
                  return { key: k.key, amount: a };
                })
                .filter(function (k) {
                  return k.amount > 0.004;
                });
              it.amount = amount;
              it.short = false;
              available[it.from] = B.round(available[it.from] - amount);
            }
            rows.push(it);
          });
        S.ui.cActions = rows;
        return rows;
      }
      function actionsCard(t) {
        var rows = feasibleActions(t),
          review = A.reviewRows().length,
          html = "";
        if (review)
          html += A.li(review + " payments to check", "", "", "go", "review");
        if (
          t.todo.some(function (it) {
            return it.payday && !it.waiting;
          })
        )
          html += A.li("Sort payday", "", "", "go", "payday");
        var visible = rows.filter(function (it) {
          return A.getSetting("nudge.defer." + it.key, "") !== now();
        });
        html += visible
          .slice(0, S.ui.cAll ? visible.length : 3)
          .map(function (it) {
            var index = rows.indexOf(it),
              move = it.type === "move";
            return (
              '<div class="c-action"><strong>' +
              E(
                A.MT(
                  move
                    ? "Move " +
                        B.money(it.amount) +
                        " from " +
                        B.accName(db(), it.from) +
                        " to " +
                        B.accName(db(), it.to)
                    : it.what,
                ),
              ) +
              "</strong>" +
              button(
                it.type === "warn" ? "Review budget" : move
                  ? "View move"
                  : it.type === "loan" && it.borrower !== me()
                    ? "It arrived"
                    : "I’ve paid",
                "cAction",
                String(index),
                "ghost sm",
              ) +
              "</div>"
            );
          })
          .join("");
        if (visible.length > 3)
          html += button(
            S.ui.cAll ? "Show fewer" : "Show all moves",
            "cAll",
            undefined,
            "ghost wide",
          );
        return html
          ? '<section id="c-actions">' + card('<h2>To do</h2><div class="list">' + html + "</div>") + '</section>'
          : "";
      }
      ACT.cAll = function () {
        S.ui.cAll = !S.ui.cAll;
        render();
      };
      ACT.cAction = function (v) {
        var it = (S.ui.cActions || [])[+v];
        if (!it) return;
        if (it.type === "warn") { go("plan"); return; }
        if (it.type !== "move") {
          A.tick(it);
          return;
        }
        S.ui.cConfirm = it;
        A.openSheet(
          "<h2>Move " +
            M(it.amount) +
            '</h2><div class="list">' +
            A.li("From", "", E(B.accName(db(), it.from))) +
            A.li("To", "", E(B.accName(db(), it.to))) +
            '</div><p class="small">' +
            E(A.MT(it.why || "This keeps your pots in line with the budget.")) +
            '</p><p class="small muted">Make this move in ' +
            E(A.bankName()) +
            ", then confirm here.</p>" +
            button("I’ve moved it", "cMoved", undefined, "wide") +
            button("Later", "sheetclose", undefined, "ghost wide"),
        );
      };
      ACT.cMoved = function () {
        var it = S.ui.cConfirm;
        if (!it) return;
        var current = feasibleActions(B.today(db(), me(), now())).find(
          function (x) {
            return (
              x.key === it.key &&
              x.from === it.from &&
              x.to === it.to &&
              x.amount >= it.amount - 0.004
            );
          },
        );
        if (!current) {
          A.closeSheet();
          A.toast("This move has changed. Check the latest To do.");
          render();
          return;
        }
        A.closeSheet();
        A.tick(it);
        S.ui.cConfirm = null;
      };
      var oldToday = V.today;
      V.today = function () {
        var d = db(),
          p = me();
        if (
          !d.income.some(function (x) {
            return x.person === p && x.isPay;
          })
        )
          return oldToday();
        var t = B.today(d, p, now()),
          parts = guideParts(t),
          html = "";
        if (S.storageError || S.lastError)
          html += A.li(
            "Sync needs attention",
            E(S.storageError || S.lastError),
            "",
            "go",
            "sync",
          );
        var days = Math.max(0, B.diff(now(), t.nextPay)),
          paydayWord = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days + " days",
          shortName = function (name) { return name.replace(/^Fun and spending$/i, "Fun"); },
          active = parts.filter(function (x) { return x.amount > 0.004; }),
          context = active.length === 1 ? "Today’s guide comes from " + shortName(active[0].name)
            : active.length ? "Split across your daily budgets"
            : t.budgetDay > t.cashDay ? "Available cash is limiting today’s guide" : "No daily allowance available";
        html +=
          '<button type="button" id="c-guide" class="hero card c-guide" data-a="herosheet"><div class="c-guide-top"><span>Daily guide</span><span class="c-guide-link">View breakdown ↗</span></div><div class="c-guide-main"><div class="c-guide-total"><div class="big">' +
          M(t.safe) +
          '</div><span class="small">per day</span></div><div class="c-guide-payday">' + A.icon("cal",22) + '<span>Payday</span><strong>' + E(paydayWord) + '</strong><span>' + E(B.nice(t.nextPay)) + '</span></div></div><div class="c-guide-parts">' +
          parts.map(function (x) {
            var over = x.left < -0.004, left = Math.max(0,x.left),
              fill = left ? Math.min(100, Math.round(x.limit > 0 ? left / x.limit * 100 : 100)) : 0,
              state = over ? M(-x.left) + " over" : left > 0.004 ? M(left) + " left" : "Budget used",
              symbol = /food|grocer/i.test(x.name) ? "basket" : /fuel|travel|petrol/i.test(x.name) ? "fuel" : "spark";
            return '<div class="' + (over ? "is-over" : x.amount > 0.004 ? "is-active" : "") + '"><span class="c-guide-category"><span class="c-guide-icon">' + A.icon(symbol,21) + '</span><span class="c-guide-name">' + E(shortName(x.name)) + '</span></span><b>' + M(x.amount) + '</b><span class="c-guide-state">' + state + '</span><span class="c-guide-meter" aria-hidden="true"><i style="width:' + fill + '%"></i></span></div>';
          }).join("") +
          '</div><div class="c-guide-context">' + A.icon("info",14) + '<span>' + E(context) + '</span></div></button>';
        if (t.plan.shortfall > 0.004)
          html += A.li(
            "Budget needs attention",
            M(t.plan.shortfall) + " more planned than available",
            "",
            "go",
            "payday",
          );
        html += actionsCard(t);
        html += '<section id="c-budget">' + card(
          '<div class="row"><h2>Your budget</h2><span class="tiny muted">to ' +
            E(B.nice(B.addDays(t.period.next, -1))) +
            "</span></div>" +
            budgetTable(categories(t.period), t.period, false),
        ) + '</section>';
        html += originals.sorted();
        return (
          html +
          card(
            '<div class="c-quick">' +
              button("Activity", "cTab", "activity", "ghost") +
              button("Pots", "cTab", "pots", "ghost") +
              "</div>",
          )
        );
      };
      function moneyTabs(active) {
        return (
          '<div class="c-tabs">' +
          [
            ["budget", "Budget"],
            ["activity", "Activity"],
            ["pots", "Pots"],
          ]
            .map(function (t) {
              return (
                '<button type="button" class="btn ghost" data-a="cTab" data-v="' +
                t[0] +
                '" aria-pressed="' +
                (active === t[0]) +
                '">' +
                t[1] +
                "</button>"
              );
            })
            .join("") +
          "</div>"
        );
      }
      ACT.cTab = function (v) {
        S.ui.cMoney = v;
        S.ui.money = "month";
        go("money");
      };
      function budgetView(per) {
        var d = db(),
          p = me(),
          rows = categories(per),
          all = B.outgoings(d, p, per, now()).filter(function (r) {
            return r.kind === "bill" && r.status !== "skipped";
          }),
          due = all
            .filter(function (r) {
              return r.status !== "paid";
            })
            .reduce(function (n, r) {
              return n + r.amount;
            }, 0);
        return (
          card("<h2>Spending</h2>" + budgetTable(rows, per, false)) +
          card(
            '<div class="list">' +
              A.li(
                "Bills",
                M(due) + " left in this pay period",
                "",
                "cDue",
                "bills",
              ) +
              A.li("Savings and goals", "", "", "go", "goals") +
              "</div>",
          ) +
          '<div class="c-quick">' +
          button("Sort payday", "go", "payday") +
          button("Edit budgets", "go", "list:budgets", "ghost") +
          "</div>"
        );
      }
      ACT.cDue = function () {
        S.ui.cMoney = "activity";
        S.ui.cWhen = "due";
        go("money");
      };
      function activityRows(per) {
        var d = db(),
          p = me(),
          date = now(),
          rows = B.outgoings(d, p, per, date).map(function (r) {
            return Object.assign({}, r, { incoming: false });
          });
        d.transactions
          .filter(function (x) {
            return (
              x.person === p &&
              x.amount < 0 &&
              x.date >= per.start &&
              x.date < per.next
            );
          })
          .forEach(function (x) {
            rows.push({
              id: x.id,
              kind: "payment",
              name: x.note || "Money in",
              date: x.date,
              amount: -x.amount,
              account: x.account,
              status: "paid",
              incoming: true,
            });
          });
        d.income
          .filter(function (x) {
            return x.person === p;
          })
          .forEach(function (x) {
            B.occurrencesAll(d, x, per.start, per.next).forEach(function (o) {
              var duplicate = d.transactions.some(function (t) {
                return (
                  t.person === p &&
                  t.amount < 0 &&
                  Math.abs(t.amount + o.amount) < 0.005 &&
                  Math.abs(B.diff(t.date, o.date)) <= 3 &&
                  String(t.note || "").toLowerCase() ===
                    String(x.name || "").toLowerCase()
                );
              });
              if (!duplicate)
                rows.push({
                  id: o.key,
                  item: x.id,
                  table: "income",
                  kind: "income",
                  name: x.name,
                  date: o.date,
                  amount: o.amount,
                  account: x.account || B.mainOf(d, p),
                  status: o.skipped
                    ? "skipped"
                    : o.paid ||
                        (o.date <= date &&
                          (!x.isPay ||
                            !B.payPending(
                              d,
                              p,
                              B.periodAt(d, p, o.date),
                              date,
                            )))
                      ? "paid"
                      : "due",
                  incoming: true,
                });
            });
          });
        d.settlements
          .filter(function (x) {
            return x.to === p && x.date >= per.start && x.date < per.next;
          })
          .forEach(function (x) {
            rows.push({
              id: x.id,
              item: x.loan,
              kind: "receipt",
              name: A.person(x.from).name + " paid you",
              date: x.date,
              amount: x.amount,
              account: x.toAccount || B.mainOf(d, p),
              status: "paid",
              incoming: true,
            });
          });
        d.transfers
          .filter(function (x) {
            return x.to === p;
          })
          .forEach(function (x) {
            B.occurrencesAll(d, x, per.start, per.next).forEach(function (o) {
              rows.push({
                id: o.key,
                item: x.id,
                table: "transfers",
                kind: "incoming",
                name: x.name || "Payment from " + A.person(x.from).name,
                date: o.date,
                amount: o.amount,
                account: x.toAccount || B.mainOf(d, p),
                status: o.paid ? "paid" : o.date < date ? "late" : "due",
                incoming: true,
              });
            });
          });
        return rows;
      }
      function activityView(per) {
        var due = S.ui.cWhen === "due",
          filter = S.ui.cFlow || "all",
          rows = activityRows(per).filter(function (r) {
            return due
              ? r.status !== "paid" && r.status !== "skipped"
              : r.status === "paid" && r.date <= now();
          });
        if (!due)
          rows = rows.filter(function (r) {
            return filter === "in"
              ? r.incoming
              : filter === "out"
                ? !r.incoming
                : true;
          });
        rows.sort(function (a, b) {
          return due
            ? a.date.localeCompare(b.date)
            : b.date.localeCompare(a.date) ||
                String(b.id).localeCompare(String(a.id));
        });
        S.ui.cActivity = {};
        var html =
          '<div class="c-activity-switch">' +
          button("Recent", "cWhen", "recent", due ? "ghost" : "") +
          button("Due next", "cWhen", "due", due ? "" : "ghost") +
          "</div>";
        if (!due)
          html +=
            '<div class="c-tabs">' +
            [
              ["all", "All"],
              ["out", "Money out"],
              ["in", "Money in"],
            ]
              .map(function (x) {
                return (
                  '<button type="button" class="chip" data-a="cFlow" data-v="' +
                  x[0] +
                  '" aria-pressed="' +
                  (filter === x[0]) +
                  '">' +
                  x[1] +
                  "</button>"
                );
              })
              .join("") +
            "</div>";
        var last = "";
        html +=
          '<div class="c-activity">' +
          rows
            .map(function (r) {
              S.ui.cActivity[r.id] = r;
              var date =
                r.date !== last
                  ? '<div class="c-date">' + E(B.nice(r.date)) + "</div>"
                  : "";
              last = r.date;
              return (
                date +
                card(
                  '<button type="button" class="li" data-a="cActivity" data-v="' +
                    E(r.id) +
                    '"><span class="grow"><span class="what">' +
                    E(r.name) +
                    '</span><span class="why">' +
                    E(B.accName(db(), r.account)) +
                    (due && r.date < now() ? " · Not matched" : "") +
                    '</span></span><span class="rt">' +
                    A.num((r.incoming ? "+" : "") + M(r.amount)) +
                    "</span></button>",
                  "flush",
                )
              );
            })
            .join("") +
          "</div>";
        return (
          html +
          (rows.length
            ? ""
            : card(
                '<p class="c-actions-empty">' +
                  (due
                    ? "Nothing else due in this period."
                    : "No payments in this view.") +
                  "</p>",
              ))
        );
      }
      ACT.cWhen = function (v) {
        S.ui.cWhen = v;
        render();
      };
      ACT.cFlow = function (v) {
        S.ui.cFlow = v;
        render();
      };
      ACT.cActivity = function (id) {
        var r = (S.ui.cActivity || {})[id];
        if (!r) return;
        if (r.kind === "payment") {
          ACT.exclassify(id);
          return;
        }
        A.openSheet(
          "<h2>" +
            E(r.name) +
            '</h2><div class="big">' +
            (r.incoming ? "+" : "") +
            M(r.amount) +
            '</div><p class="small">' +
            E(B.nice(r.date)) +
            " · " +
            E(B.accName(db(), r.account)) +
            "</p>" +
            (r.status === "paid"
              ? '<p class="small muted">Recorded in your activity.</p>'
              : '<p class="small muted">' +
                (r.date < now()
                  ? "Not yet matched to a bank payment."
                  : "Scheduled payment.") +
                "</p>") +
            (r.table
              ? button(
                  r.table === "bills"
                    ? "View bill"
                    : r.table === "income"
                      ? "View income rule"
                      : "View payment rule",
                  "cRule",
                  id,
                  "ghost wide",
                )
              : "") +
            button("Close", "sheetclose", undefined, "wide"),
        );
      };
      ACT.cRule = function (id) {
        var r = S.ui.cActivity[id];
        A.closeSheet();
        if (r) ACT.edit(r.table + ":" + r.item);
      };
      V.pots = function () {
        var d = db(),
          balances = B.balances(d, now());
        return card(
          '<div class="list">' +
            B.accountsOf(d, me())
              .filter(function (a) {
                return /^(main|pot|saving)$/.test(a.kind);
              })
              .map(function (a) {
                return A.li(
                  E(a.name),
                  "",
                  A.num(M(balances[a.id] || 0)),
                  "cPot",
                  a.id,
                );
              })
              .join("") +
            "</div>",
        );
      };
      ACT.cPot = function (id) {
        var d = db(),
          a = d.byId[id];
        if (!a || a.owner !== me()) return;
        var moves = d.moves
          .filter(function (m) {
            return !m.dup && m.date <= now() && (m.from === id || m.to === id);
          })
          .sort(function (x, y) {
            return (
              y.date.localeCompare(x.date) ||
              (+y.updated || 0) - (+x.updated || 0)
            );
          })
          .slice(0, 6);
        A.openSheet(
          "<h2>" +
            E(a.name) +
            '</h2><div class="big">' +
            M(B.balances(d, now())[id] || 0) +
            "</div>" +
            (moves.length
              ? '<h3>Recent moves</h3><div class="list">' +
                moves
                  .map(function (m) {
                    var incoming = m.to === id;
                    return A.li(
                      E(
                        (incoming ? "From " : "To ") +
                          B.accName(d, incoming ? m.from : m.to),
                      ),
                      E(B.nice(m.date)),
                      A.num((incoming ? "+" : "−") + M(m.amount)),
                    );
                  })
                  .join("") +
                "</div>"
              : "") +
            button("Close", "sheetclose", undefined, "wide"),
        );
      };
      var oldPots = V.pots;
      V.money = function () {
        if (S.ui.money === "year") {
          S.ui.money = "month";
        }
        var tab = S.ui.cMoney || "budget";
        if (tab === "pots") return moneyTabs(tab) + oldPots();
        var per = selectedPeriod();
        return (
          moneyTabs(tab) +
          periodHeading(per) +
          (tab === "activity" ? activityView(per) : budgetView(per))
        );
      };
      V.plan = function () {
        var per = B.periodAt(db(), me(), now());
        return periodHeading(per) + budgetView(per);
      };
      V.payments = function (params) {
        var d = db(),
          p = me(),
          per = B.periodAt(d, p, params.start || now()),
          budget = d.byId[params.budget];
        if (!budget)
          return moneyTabs("activity") + periodHeading(per) + activityView(per);
        var state = B.budgetState(d, p, per)[budget.id];
        if (!state)
          return card(
            '<p class="small muted">This budget is not active in this period.</p>',
          );
        var from = state.period.start,
          to = state.period.next,
          rows = d.transactions
            .filter(function (x) {
              var other = d.byId[x.budget],
                same =
                  x.person === p
                    ? x.budget === budget.id
                    : !!x.split &&
                      other &&
                      String(other.name).toLowerCase() ===
                        String(budget.name).toLowerCase(),
                date = x.refundDate || x.date;
              return (
                same &&
                !x.isBillPayment &&
                date >= from &&
                date < to &&
                date >= B.startOf(d, p) &&
                x.date <= now()
              );
            })
            .sort(function (a, b) {
              return (
                b.date.localeCompare(a.date) ||
                (+b.updated || 0) - (+a.updated || 0)
              );
            });
        return (
          card(
            "<h2>" +
              E(budget.name) +
              "</h2>" +
              budgetTable(
                [
                  {
                    id: budget.id,
                    name: budget.name,
                    amount: state.avail,
                    spent: state.spent,
                    left: state.left,
                  },
                ],
                per,
                true,
              ),
          ) +
          '<h2 class="c-section">Expenses</h2>' +
          card(
            '<div class="list">' +
              (rows.length
                ? rows
                    .map(function (x) {
                      var share = B.myShare(d, p, x),
                        why =
                          B.nice(x.date) +
                          " · " +
                          B.accName(d, x.account) +
                          (Math.abs(share - x.amount) > 0.005
                            ? " · Your share"
                            : ""),
                        tag = x.person === p ? "button" : "div";
                      return (
                        "<" +
                        tag +
                        (tag === "button"
                          ? ' type="button" data-a="exclassify" data-v="' +
                            E(x.id) +
                            '"'
                          : "") +
                        ' class="li"><span class="grow"><span class="what">' +
                        E(x.note || "Payment") +
                        '</span><span class="why">' +
                        E(why) +
                        "</span></span>" +
                        A.num((share < 0 ? "+" : "") + M(Math.abs(share))) +
                        "</" +
                        tag +
                        ">"
                      );
                    })
                    .join("")
                : '<p class="c-actions-empty">No expenses in this period.</p>') +
              "</div>",
          ) +
          button("Change budget", "edit", "budgets:" + budget.id, "ghost wide")
        );
      };
      V.spare = function () {
        var d = db(),
          p = me(),
          cfg = B.spareRules(d, p, now()) || {
            buffer: 0,
            target: 0,
            emergency: B.fallbackOf(d, p),
            savings: "",
            when: "soon",
            unspent: true,
            oneoff: true,
            repayments: true,
            ended: true,
          },
          accounts = B.accountsOf(d, p).filter(function (a) {
            return /^(pot|saving|isa)$/.test(a.kind);
          }),
          options = function (selected, blank) {
            return (
              '<option value="">' +
              E(blank) +
              "</option>" +
              accounts
                .map(function (a) {
                  return (
                    '<option value="' +
                    E(a.id) +
                    '"' +
                    (selected === a.id ? " selected" : "") +
                    ">" +
                    E(a.name) +
                    "</option>"
                  );
                })
                .join("")
            );
          },
          daily = d.bills.filter(function (b) {
            return (
              b.person === p &&
              b.toAccount &&
              /^(day|days)$/.test(b.unit) &&
              (!b.end || b.end >= now())
            );
          });
        return (
          card(
            '<label class="f">Keep in Main (£)<input id="exBuffer" inputmode="decimal" value="' +
              E(cfg.buffer) +
              '"></label><label class="f">Save spare money in<select id="exSavings">' +
              options(cfg.savings, "Choose a pot") +
              "</select></label>",
          ) +
          (daily.length
            ? card(
                '<h2>Daily saving</h2><div class="list">' +
                  daily
                    .map(function (b) {
                      return A.li(
                        E(b.name),
                        M(B.amountAt(d, b, now())) +
                          " today · " +
                          B.money(+b.dailyIncrease || 0) +
                          " increase each day",
                        "",
                        "edit",
                        "bills:" + b.id,
                      );
                    })
                    .join("") +
                  "</div>",
              )
            : "") +
          card(
            '<details><summary>Advanced</summary><label class="f">When to suggest a move<select id="exWhen"><option value="soon"' +
              (cfg.when === "soon" ? " selected" : "") +
              '>As soon as it is spare</option><option value="payday"' +
              (cfg.when === "payday" ? " selected" : "") +
              '>Payday only</option></select></label><label class="f">Emergency pot (optional)<select id="exEmergency">' +
              options(cfg.emergency, "No emergency target") +
              '</select></label><label class="f">Emergency target (£)<input id="exTarget" inputmode="decimal" value="' +
              E(cfg.target || 0) +
              '"></label>' +
              [
                ["unspent", "Unspent budgets on payday"],
                ["oneoff", "One-off money in"],
                ["repayments", "IOU repayments"],
                ["ended", "Bills that have ended"],
              ]
                .map(function (x) {
                  return (
                    '<label class="li check"><span class="grow">' +
                    x[1] +
                    '</span><input type="checkbox" id="ex-' +
                    x[0] +
                    '"' +
                    (cfg[x[0]] ? " checked" : "") +
                    "></label>"
                  );
                })
                .join("") +
              "</details>",
          ) +
          button("Save rules", "exsaveSpare", undefined, "wide")
        );
      };
      var oldDebts = V.debts;
      V.debts = function () {
        var d = db(),
          credits = B.accountsOf(d, me()).filter(function (a) {
            return a.kind === "credit";
          }),
          box = document.createElement("div");
        box.innerHTML = oldDebts();
        Array.from(box.querySelectorAll(".card")).forEach(function (el) {
          if (
            credits.some(function (a) {
              return (
                el.querySelector(".row>span") &&
                el.querySelector(".row>span").textContent === a.name
              );
            })
          )
            el.remove();
        });
        return (
          box.innerHTML +
          credits
            .map(function (a) {
              var known = d.valuations.some(function (v) {
                  return v.account === a.id;
                }),
                balance = B.balances(d, now())[a.id] || 0;
              return card(
                '<div class="row"><h2>' +
                  E(a.name) +
                  "</h2>" +
                  A.num(known ? M(Math.max(0, -balance)) : "Balance needed") +
                  "</div>" +
                  button(
                    known ? "Update balance" : "Add balance",
                    "cCredit",
                    a.id,
                    "ghost wide",
                  ),
              );
            })
            .join("")
        );
      };
      ACT.cCredit = function (id) {
        var a = db().byId[id];
        if (!a || a.owner !== me() || a.kind !== "credit") return;
        S.ui.cCredit = id;
        var known = db().valuations.some(function (v) {
          return v.account === id;
        });
        A.openSheet(
          "<h2>" +
            E(a.name) +
            '</h2><label class="f">Amount currently owed (£)<input id="cCreditOwed" inputmode="decimal" value="' +
            (known
              ? E(B.round(Math.max(0, -(B.balances(db(), now())[id] || 0))))
              : "") +
            '"></label>' +
            button("Save balance", "cCreditSave", undefined, "wide"),
        );
      };
      ACT.cCreditSave = function () {
        var a = db().byId[S.ui.cCredit],
          input = document.querySelector("#cCreditOwed"),
          value = input && input.value.trim(),
          amount = +String(value).replace(/[£,\s]/g, "");
        if (
          !a ||
          a.owner !== me() ||
          a.kind !== "credit" ||
          !value ||
          !isFinite(amount) ||
          amount < 0
        ) {
          A.toast("Enter zero or the amount owed");
          return;
        }
        A.put(
          "valuations",
          {
            id: A.newId("val"),
            account: a.id,
            date: now(),
            amount: -B.round(amount),
          },
          true,
        );
        A.closeSheet();
        render();
      };
      V.more = originals.more;
      A.tour(function () {
        var t = B.today(db(), me(), now()), q = A.person(A.partner()).name || "Your partner";
        var example = '<div class="c-budget-head"><span>Budget</span><span>Spent</span><span>Left</span></div><div class="c-budget-row"><span><strong>Food</strong><small>£200 budget</small></span><span>£45</span><span>£155</span></div>';
        return [
          {t:"Your daily guide",s:"This is a pace for Food, Fuel and Fun until payday, limited by available cash after commitments. Each category still has its own budget. Tap the card to see the per-day breakdown.",m:'<div class="hero card"><div class="big">'+M(t.safe)+'</div><span>per day</span></div>',show:"guide"},
          {t:"What needs doing",s:"To do comes before the budget. It shows bank moves you can actually fund and payments to check. Budgie reads your bank; it never moves money for you. A budget going over does not, by itself, mean Main needs emergency money.",m:'<p>Check → move in your bank → confirm</p>',show:"actions"},
          {t:"Budget, Spent and Left",s:"Budget is the allowance for this pay period. Spent is your share of recorded expenses, less linked refunds. Left is the difference; an overspend stays visible. Tap a category to see the expenses behind it.",m:example,show:"budget"},
          {t:"Your payments",s:"Activity starts with the most recent receipts. Money in and Money out are filters; Due next contains scheduled payments. Opening a receipt lets you check its budget, link a refund or match a bill.",m:'<p>Recent · Due next<br>All · Money out · Money in</p>',show:"activity"},
          {t:"Where the money is",s:"Pots show account balances separately from category allowances. A purchase from Main can still reduce Food. Moving money between your own pots does not count as another expense.",m:'<p>Balances and recent pot moves</p>',show:"pots"},
          {t:"Payday",s:"Once your pay is seen, sort it into the pots listed here. Existing money in each pot counts towards what it needs, including bills and yearly costs. Only confirm a move after you have made it.",m:'<p>Pay → commitments → budgets → saving</p>',show:"payday"},
          {t:"Daily saving and spare money",s:"Daily saving is a scheduled transfer, including its 1p daily increase. It is protected alongside bills. Saving rules keep your Main buffer before suggesting genuinely spare money for the destination you chose.",m:'<p>Daily saving · Main buffer · Savings</p>',show:"spare"},
          {t:q+"’s overview",s:"Category amounts are budget allowances, not bank balances. A bank balance is shown separately only if shared. Shared bills show each person's share; itemised IOUs keep purchases and repayments together.",m:'<p>Budget · shared bills · IOUs · shared goals</p>',show:"partner"},
          {t:"Goals and the forecast",s:"A target is an intention. The forecast only counts the accounts and saving routes attached to it. Sales, gifts and extra income are not cash until recorded. Open a goal to check what counts towards it.",m:'<p>Saved so far → saving planned → target date</p>',show:"goals"}
        ];
      });
      ACT.extourShow = function (target) {
        var routes = {guide:["today","#c-guide"],actions:["today","#c-actions"],budget:["today","#c-budget"],activity:["money",".c-tabs"],pots:["money",".c-tabs"]};
        var r = routes[target] || [target,"main"], selector = r[1];
        if (target === "activity" || target === "pots") S.ui.cMoney = target;
        // go closes the sheet and reuses its history entry. Closing it separately races the scroll with Back.
        go(r[0]);
        setTimeout(function () {
          var el = document.querySelector(selector) || document.querySelector("#c-budget") || document.querySelector("main");
          if (el) { el.classList.add("c-tour-focus"); el.scrollIntoView({block:"center",behavior:"instant"}); setTimeout(function () { el.classList.remove("c-tour-focus"); },2200); }
        },180);
      };
      var oldPartner = V.partner;
      V.partner = function () {
        var q = A.partner();
        if (!q) return oldPartner();
        var sm = S.prefs.demo
            ? B.summary(db(), q, now())
            : S.data.summary || {},
          box = document.createElement("div");
        box.innerHTML = oldPartner();
        if (box.firstElementChild) box.firstElementChild.remove();
        var next = sm.nextPay ? 'Next payday · ' + B.nice(sm.nextPay) : "";
        var overview = '<section id="c-partner"><div class="card"><div class="row"><h2>' + E(A.person(q).name) + '</h2></div><p class="small muted">' + E(next) + '</p><div class="list c-partner-overview">';
        overview += sm.mainBalance ? A.li("Current account", "Last balance · " + E(B.nice(sm.mainBalance.date)), A.num(M(sm.mainBalance.amount))) : A.li("Current account", "Bank balance isn’t shared", "");
        if (sm.safe !== undefined) overview += A.li("Daily guide", "Cash-limited budget pace", A.num(M(sm.safe)));
        if (sm.bills !== undefined) overview += A.li("Bills this pay period", "Planned commitments", A.num(M(sm.bills)));
        if (sm.saved !== undefined) overview += A.li("Saving this pay period", "Planned contributions", A.num(M(sm.saved)));
        overview += '</div></div></section>';
        return overview + (
          card(
            "<h2>" +
              E(A.person(q).name) +
              "’s budget</h2>" +
              (sm.tiles
                ? budgetTable(sm.tiles, null, true) + '<p class="c-budget-caption">Left is the category allowance, not the bank balance.</p>'
                : '<p class="small muted">Budget details aren’t shared.</p>'),
          ) + box.innerHTML
        );
      };
    },
  };
})();
