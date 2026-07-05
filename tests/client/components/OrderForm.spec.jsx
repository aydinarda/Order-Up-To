import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrderForm from "../../../src/components/OrderForm.jsx";

const config = { truckCapacity: 100 };

describe("OrderForm", () => {
  it("submits the entered order-up-to level as a number", async () => {
    const onSubmit = vi.fn();
    render(<OrderForm onSubmit={onSubmit} disabled={false} onHand={100} inTransit={50} config={config} />);

    const input = screen.getByLabelText(/order-up-to level/i);
    await userEvent.clear(input);
    await userEvent.type(input, "300");
    await userEvent.click(screen.getByRole("button", { name: /submit level/i }));

    expect(onSubmit).toHaveBeenCalledWith(300);
  });

  it("previews the resulting order quantity and truck count from S and IP", async () => {
    const onSubmit = vi.fn();
    // IP = onHand + inTransit = 150; S = 400 -> q = 250 -> 3 trucks.
    render(<OrderForm onSubmit={onSubmit} disabled={false} onHand={100} inTransit={50} config={config} />);

    await userEvent.type(screen.getByLabelText(/order-up-to level/i), "400");
    expect(screen.getByText(/250 units/i)).toBeInTheDocument();
    expect(screen.getByText(/3 trucks/i)).toBeInTheDocument();
  });

  it("rejects an empty level with an error and does not submit", async () => {
    const onSubmit = vi.fn();
    render(<OrderForm onSubmit={onSubmit} disabled={false} onHand={0} inTransit={0} config={config} />);

    await userEvent.click(screen.getByRole("button", { name: /submit level/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/non-negative integer/i)).toBeInTheDocument();
  });

  it("disables the input and button when disabled", () => {
    render(<OrderForm onSubmit={() => {}} disabled onHand={0} inTransit={0} config={config} />);
    expect(screen.getByLabelText(/order-up-to level/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /submit level/i })).toBeDisabled();
  });
});
