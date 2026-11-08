import { describe, expect, it } from "vitest";
import { enumLabels } from "./mysql-layout";
import { grantWrites } from "./mysql";

describe("MySQL's own words, read by code", () => {
  it("tells a reader's grants from a writer's and a superuser's", () => {
    expect(grantWrites(["GRANT USAGE ON *.* TO `reader`@`%`", "GRANT SELECT, SHOW VIEW ON `shop`.* TO `reader`@`%`"])).toEqual({ writes: [], superuser: false });
    expect(grantWrites(["GRANT USAGE ON *.* TO `writer`@`%`", "GRANT SELECT ON `shop`.* TO `writer`@`%`", "GRANT INSERT ON `shop`.`orders` TO `writer`@`%`"])).toEqual({ writes: ["shop.orders"], superuser: false });
    expect(grantWrites(["GRANT ALL PRIVILEGES ON *.* TO `root`@`%` WITH GRANT OPTION"])).toEqual({ writes: ["*.*"], superuser: true });
    expect(grantWrites(["GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, SUPER ON *.* TO `root`@`%` WITH GRANT OPTION"]).superuser).toBe(true);
    // Temporary tables are the session's own: not a write to the team's data.
    expect(grantWrites(["GRANT SELECT, CREATE TEMPORARY TABLES ON `shop`.* TO `reader`@`%`"]).writes).toEqual([]);
    // A role granted is a line of its own, read again with its privileges (SHOW GRANTS … USING).
    expect(grantWrites(["GRANT `editors`@`%` TO `member`@`%`"]).writes).toEqual([]);
  });

  it("reads an enum's labels from its type", () => {
    expect(enumLabels("enum('pending','paid','it''s')")).toEqual(["pending", "paid", "it's"]);
    expect(enumLabels("varchar(10)")).toEqual([]);
  });
});
