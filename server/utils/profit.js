const DEFAULT_PRICES = {
  wholesaleCost: 10,
  retailPrice: 40,
  salvagePrice: 5
};

export function calculateProfit(orderQuantity, realizedDemand, prices = DEFAULT_PRICES) {
  const { wholesaleCost, retailPrice, salvagePrice } = prices;
  const soldUnits = Math.min(orderQuantity, realizedDemand);
  const unsoldUnits = Math.max(0, orderQuantity - soldUnits);
  const revenue = soldUnits * retailPrice;
  const salvageValue = unsoldUnits * salvagePrice;
  const totalCost = orderQuantity * wholesaleCost;
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
