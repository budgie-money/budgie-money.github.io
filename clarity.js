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
                over = t.left < -0.004;
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
                M(Math.abs(t.left)) +
                (over ? '<small class="c-over">over</small>' : "") +
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
          used = 0;
        return list.map(function (x, i) {
          var a =
            i === list.length - 1
              ? B.round(Math.max(0, t.safe - used))
              : B.round(total ? (Math.max(0, x.left) / total) * t.safe : 0);
          a = Math.min(a, Math.max(0, B.round(t.safe - used)));
          used = B.round(used + a);
          return { name: x.name, left: x.left, amount: a };
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
                  M(Math.max(0, x.left)) + " left until payday",
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
            if (it.type === "warn") return;
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
                move
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
          ? card('<h2>To do</h2><div class="list">' + html + "</div>")
          : "";
      }
      ACT.cAll = function () {
        S.ui.cAll = !S.ui.cAll;
        render();
      };
      ACT.cAction = function (v) {
        var it = (S.ui.cActions || [])[+v];
        if (!it) return;
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
        html +=
          '<button type="button" class="hero card c-guide" data-a="herosheet"><span class="small">Daily guide</span><div class="big">' +
          M(t.safe) +
          '</div><div class="c-guide-parts">' +
          parts
            .map(function (x) {
              return (
                "<div><span>" +
                E(x.name) +
                "</span><b>" +
                M(x.amount) +
                "</b></div>"
              );
            })
            .join("") +
          "</div></button>";
        if (t.plan.shortfall > 0.004)
          html += A.li(
            "Budget needs attention",
            M(t.plan.shortfall) + " more planned than available",
            "",
            "go",
            "payday",
          );
        html += card(
          '<div class="row"><h2>Your budget</h2><span class="tiny muted">to ' +
            E(B.nice(B.addDays(t.period.next, -1))) +
            "</span></div>" +
            budgetTable(categories(t.period), t.period, false),
        );
        html += actionsCard(t);
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
        return (
          card(
            "<h2>" +
              E(A.person(q).name) +
              "’s budget</h2>" +
              (sm.tiles
                ? budgetTable(sm.tiles, null, true)
                : '<p class="small muted">Budget details aren’t shared.</p>'),
          ) + box.innerHTML
        );
      };
    },
  };
})();
