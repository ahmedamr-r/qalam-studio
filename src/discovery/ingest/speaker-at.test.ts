import { describe, expect, it } from "vitest";
import { speakerAt } from "./speaker-at";

const at = (text: string, words: string): [number, number] => {
  const i = text.indexOf(words);
  return [i, i + words.length];
};

describe("speakerAt", () => {
  it("reads the name a sheet's row starts with", () => {
    const text = "Ahmed S.: Riders put the pin in the middle of the compound\n\nMohamed R.: Long pickups aren't paid";
    expect(speakerAt(text, at(text, "Riders put the pin"))).toBe("Ahmed S.");
    expect(speakerAt(text, at(text, "Long pickups"))).toBe("Mohamed R.");
  });

  it("skips a label with digits in a chat's lead-in", () => {
    const text = 'Chat 1, rider Hoda: "I booked at 8:05 and the ETA kept going up"';
    expect(speakerAt(text, at(text, "I booked at 8:05"))).toBe("rider Hoda");
  });

  it("finds the heading above, within its block", () => {
    const text = 'Mariam, 29, New Cairo, rides daily to work:\n"The driver called me three times"\n"I cancel when the car is 12 minutes away"\n\nOmar, 34, Maadi:\n"The price at the end was 40 pounds more"';
    expect(speakerAt(text, at(text, "The driver called me"))).toBe("Mariam");
    expect(speakerAt(text, at(text, "I cancel when"))).toBe("Mariam");
    expect(speakerAt(text, at(text, "The price at the end"))).toBe("Omar");
  });

  it("names nobody when the text doesn't", () => {
    const text = 'App Store reviews, October 2026\n\n★☆☆☆☆ "Fare went from 85 to 130 EGP"';
    expect(speakerAt(text, at(text, "Fare went from"))).toBeUndefined();
    expect(speakerAt("Just a sentence about fares.", [7, 15])).toBeUndefined();
  });

  it("never reads past a block a heading doesn't start", () => {
    const text = 'Mariam:\n"First"\n\n"Second, from someone else"';
    expect(speakerAt(text, at(text, "Second"))).toBeUndefined();
  });
});
