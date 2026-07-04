export const PRICE = {
  wholesaleCost: 10,
  retailPrice: 40,
  salvagePrice: 5
};

export function calculateProfit(orderQuantity, realizedDemand) {
  const soldUnits = Math.min(orderQuantity, realizedDemand);
  const unsoldUnits = Math.max(0, orderQuantity - soldUnits);

  const revenue = soldUnits * PRICE.retailPrice;
  const salvageValue = unsoldUnits * PRICE.salvagePrice;
  const totalCost = orderQuantity * PRICE.wholesaleCost;
  const profit = revenue + salvageValue - totalCost;

  return {
    soldUnits,
    unsoldUnits,
    revenue,
    salvageValue,
    totalCost,
    profit
  };
}
