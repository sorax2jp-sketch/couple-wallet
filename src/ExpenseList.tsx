import { Expense, yen } from "./model";
export function ExpenseList({
  items,
  names,
  onSelect,
}: {
  items: Expense[];
  names: Record<string, string>;
  onSelect: (item: Expense) => void;
}) {
  return items.length ? (
    <>
      {items.map((x) => (
        <button className="expense" key={x.id} onClick={() => onSelect(x)}>
          <span>
            <strong>{x.title}</strong>
            <small>
              {x.occurredAt} · {names[x.payerUid]}
            </small>
          </span>
          <b>
            {yen(x.amountYen)} <span className="chevron">›</span>
          </b>
        </button>
      ))}
    </>
  ) : (
    <p className="empty">該当する立替はありません</p>
  );
}
