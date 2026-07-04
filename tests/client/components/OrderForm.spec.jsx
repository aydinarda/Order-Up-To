import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrderForm from "../../../src/components/OrderForm.jsx";

describe("OrderForm", () => {
  it("submits the entered quantity as a number", async () => {
    const onSubmit = vi.fn();
    render(<OrderForm onSubmit={onSubmit} disabled={false} />);

    const input = screen.getByLabelText(/order quantity/i);
    await userEvent.clear(input);
    await userEvent.type(input, "120");
    await userEvent.click(screen.getByRole("button", { name: /submit order/i }));

    expect(onSubmit).toHaveBeenCalledWith(120);
  });

  it("rejects an empty quantity with an error and does not submit", async () => {
    const onSubmit = vi.fn();
    render(<OrderForm onSubmit={onSubmit} disabled={false} />);

    // An empty number input passes HTML5 constraints but fails the JS check (Number("") === 0).
    const input = screen.getByLabelText(/order quantity/i);
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole("button", { name: /submit order/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/positive integer/i)).toBeInTheDocument();
  });

  it("disables the input and button when disabled", () => {
    render(<OrderForm onSubmit={() => {}} disabled />);
    expect(screen.getByLabelText(/order quantity/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /submit order/i })).toBeDisabled();
  });
});
