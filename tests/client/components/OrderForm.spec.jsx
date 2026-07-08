import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrderForm from "../../../src/components/OrderForm.jsx";

const config = { truckCapacity: 100, leadTime: 2 };

describe("OrderForm", () => {
  it("submits the entered order quantity as a number", async () => {
    const onSubmit = vi.fn();
    render(<OrderForm onSubmit={onSubmit} disabled={false} onHand={100} inTransit={50} config={config} />);

    const input = screen.getByLabelText(/order quantity/i);
    await userEvent.type(input, "250");
    await userEvent.click(screen.getByRole("button", { name: /submit order/i }));

    expect(onSubmit).toHaveBeenCalledWith(250);
  });

  it("previews the truck count and arrival time for the entered quantity", async () => {
    const onSubmit = vi.fn();
    // q = 250 -> 3 trucks; normal round arrives in the configured lead time (2).
    render(<OrderForm onSubmit={onSubmit} disabled={false} onHand={100} inTransit={50} config={config} />);

    await userEvent.type(screen.getByLabelText(/order quantity/i), "250");
    expect(screen.getByText(/3 trucks/i)).toBeInTheDocument();
    expect(screen.getByText(/arrives in 2 rounds/i)).toBeInTheDocument();
  });

  it("shows the priming-round hint and a 1-round arrival for the opening order", async () => {
    render(<OrderForm onSubmit={vi.fn()} disabled={false} onHand={0} inTransit={0} config={config} priming />);
    expect(screen.getByRole("heading", { name: /opening order/i })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/order quantity/i), "150");
    expect(screen.getByText(/arrives in 1 round/i)).toBeInTheDocument();
  });

  it("rejects an empty quantity with an error and does not submit", async () => {
    const onSubmit = vi.fn();
    render(<OrderForm onSubmit={onSubmit} disabled={false} onHand={0} inTransit={0} config={config} />);

    await userEvent.click(screen.getByRole("button", { name: /submit order/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/non-negative integer/i)).toBeInTheDocument();
  });

  it("disables the input and button when disabled", () => {
    render(<OrderForm onSubmit={() => {}} disabled onHand={0} inTransit={0} config={config} />);
    expect(screen.getByLabelText(/order quantity/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /submit order/i })).toBeDisabled();
  });
});
