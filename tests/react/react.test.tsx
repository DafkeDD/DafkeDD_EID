// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { MockEidClient } from "../../packages/eid/src/mock";
import { EidProvider, EidReader, fullName, useEid } from "../../packages/eid/src/react";

afterEach(cleanup);

function Status() {
  const eid = useEid();
  return (
    <div>
      <p data-testid="phase">{eid.phase}</p>
      {eid.card && <p data-testid="name">{fullName(eid.card.identity)}</p>}
      <button onClick={() => eid.clear()}>Wissen</button>
    </div>
  );
}

describe("EidProvider / useEid", () => {
  it("toont de kaart nadat ze automatisch gelezen werd (ook in StrictMode)", async () => {
    const client = new MockEidClient({ readDelayMs: 5 });
    render(
      <StrictMode>
        <EidProvider client={client}>
          <Status />
        </EidProvider>
      </StrictMode>,
    );
    expect(await screen.findByTestId("name")).toHaveProperty("textContent", "Jan Pieter Specimen");
    expect(screen.getByTestId("phase").textContent).toBe("done");

    act(() => client.removeCard());
    expect(screen.getByTestId("phase").textContent).toBe("no-card");
    expect(screen.queryByTestId("name")).toBeNull();
  });

  it("EidReader (render-prop) en clear()", async () => {
    const client = new MockEidClient({ readDelayMs: 5 });
    render(
      <EidProvider client={client}>
        <EidReader>{(eid) => <p data-testid="phase">{eid.phase}</p>}</EidReader>
        <Status />
      </EidProvider>,
    );
    await screen.findByTestId("name");
    act(() => screen.getByRole("button", { name: "Wissen" }).click());
    expect(screen.getAllByTestId("phase")[0]!.textContent).toBe("ready");
  });

  it("geeft een duidelijke fout buiten een provider", () => {
    const original = console.error;
    console.error = () => {};
    try {
      expect(() => render(<Status />)).toThrow(/binnen een <EidProvider>/);
    } finally {
      console.error = original;
    }
  });

  it("rendert op de server zonder te verbinden (fase connecting)", () => {
    const html = renderToString(
      <EidProvider client={new MockEidClient()}>
        <Status />
      </EidProvider>,
    );
    expect(html).toContain("connecting");
  });
});
