import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrderForm from "../../../src/components/OrderForm.jsx";

const config = {
  shipCapacity: 100,
  leadTime: 2,
  shipCost: 50,
  shipCo2: 100,
  expressEnabled: true,
  expressCapacity: 40,
  expressFixedCost: 120,
  expressCo2: 250
};

describe("OrderForm", () => {
  it("submits a ship-only order when the truck input is left empty", async () => {
    const onSubmit = vi.fn();
    render(<OrderForm onSubmit={onSubmit} disabled={false} onHand={100} inTransit={50} config={config} />);

    await userEvent.type(screen.getByLabelText(/ship quantity/i), "250");
    await userEvent.click(screen.getByRole("button", { name: /submit order/i }));

    expect(onSubmit).toHaveBeenCalledWith(250, 0);
  });

  it("submits a truck-only order", async () => {
    const onSubmit = vi.fn();
    render(<OrderForm onSubmit={onSubmit} disabled={false} onHand={100} inTransit={50} config={config} />);

    await userEvent.type(screen.getByLabelText(/truck quantity/i), "80");
    await userEvent.click(screen.getByRole("button", { name: /submit order/i }));

    expect(onSubmit).toHaveBeenCalledWith(0, 80);
  });

  it("submits both legs when both quantities are entered in the same round", async () => {
    const onSubmit = vi.fn();
    render(<OrderForm onSubmit={onSubmit} disabled={false} onHand={100} inTransit={50} config={config} />);

    await userEvent.type(screen.getByLabelText(/ship quantity/i), "250");
    await userEvent.type(screen.getByLabelText(/truck quantity/i), "90");
    await userEvent.click(screen.getByRole("button", { name: /submit order/i }));

    expect(onSubmit).toHaveBeenCalledWith(250, 90);
  });

  it("previews vehicle counts and arrival times per leg", async () => {
    render(<OrderForm onSubmit={vi.fn()} disabled={false} onHand={100} inTransit={50} config={config} />);

    // q = 250 -> 3 ships; normal round arrives in the configured lead time (2).
    await userEvent.type(screen.getByLabelText(/ship quantity/i), "250");
    expect(screen.getByText(/3 ships.*— arrives in 2 rounds/i)).toBeInTheDocument();

    // 90 by truck -> 3 trucks landing within this round.
    await userEvent.type(screen.getByLabelText(/truck quantity/i), "90");
    expect(screen.getByText(/3 trucks.*— arrives this round/i)).toBeInTheDocument();

    expect(screen.getByText(/total order: 340 kg/i)).toBeInTheDocument();
  });

  it("hides the truck leg and submits ship-only while the truck is switched off", async () => {
    const onSubmit = vi.fn();
    render(
      <OrderForm
        onSubmit={onSubmit}
        disabled={false}
        onHand={0}
        inTransit={0}
        config={{ ...config, expressEnabled: false }}
      />
    );

    expect(screen.queryByLabelText(/truck quantity/i)).toBeNull();
    expect(screen.queryByText("Truck")).toBeNull();

    await userEvent.type(screen.getByLabelText(/ship quantity/i), "120");
    await userEvent.click(screen.getByRole("button", { name: /submit order/i }));

    expect(onSubmit).toHaveBeenCalledWith(120, 0);
  });

  it("shows the priming-round hint and a 1-round arrival for the opening order", async () => {
    render(<OrderForm onSubmit={vi.fn()} disabled={false} onHand={0} inTransit={0} config={config} priming />);
    expect(screen.getByRole("heading", { name: /opening order/i })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/ship quantity/i), "150");
    expect(screen.getByText(/2 ships.*— arrives in 1 round/i)).toBeInTheDocument();
  });

  it("treats empty inputs as ordering nothing", async () => {
    const onSubmit = vi.fn();
    render(<OrderForm onSubmit={onSubmit} disabled={false} onHand={0} inTransit={0} config={config} />);

    await userEvent.click(screen.getByRole("button", { name: /submit order/i }));

    expect(onSubmit).toHaveBeenCalledWith(0, 0);
  });

  it("disables the inputs and button when disabled", () => {
    render(<OrderForm onSubmit={() => {}} disabled onHand={0} inTransit={0} config={config} />);
    expect(screen.getByLabelText(/ship quantity/i)).toBeDisabled();
    expect(screen.getByLabelText(/truck quantity/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /submit order/i })).toBeDisabled();
  });
});
