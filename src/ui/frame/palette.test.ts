import { describe, expect, it } from "vitest";
import { withAsk } from "./palette";

describe("withAsk", () => {
  it("leaves what a name found first", () => {
    expect(withAsk(["Brain dump"], "ask", "Brain dump")).toEqual(["Brain dump", "ask"]);
    expect(withAsk(["Connections"], "ask", "conn")).toEqual(["Connections", "ask"]);
  });

  it("asks first when it reads as a question", () => {
    expect(withAsk(["Churn"], "ask", "why do customers churn")).toEqual(["ask", "Churn"]);
    expect(withAsk(["Churn"], "ask", "churn?")).toEqual(["ask", "Churn"]);
  });

  it("asks when nothing else matched", () => {
    expect(withAsk([], "ask", "late deliveries")).toEqual(["ask"]);
  });
});
