import { describe, expect, it } from "vitest";
import { dataIcon, hostOf, iconLinks, iconType, isHost } from "./favicon";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const ICO = Uint8Array.from([0, 0, 1, 0, 1, 0, 16, 16]);

describe("favicons", () => {
  it("takes a host only as a plain name", () => {
    expect(hostOf("https://WWW.Reddit.com/r/x?y=1")).toBe("www.reddit.com");
    expect(hostOf("javascript:alert(1)")).toBeNull();
    expect(isHost("apps.apple.com")).toBe(true);
    for (const bad of ["localhost", "../etc/passwd", "a..b", "-x.com", "x.com/", "x.com:80", ""]) expect(isHost(bad), bad).toBe(false);
  });

  it("knows a bitmap by its bytes, and no SVG", () => {
    expect(iconType(PNG)).toBe("image/png");
    expect(iconType(ICO)).toBe("image/x-icon");
    expect(iconType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
    expect(iconType(new TextEncoder().encode("<!doctype html><html>"))).toBeNull();
  });

  it("reads the icons a page names, about 32px first, without SVG or mask icons", () => {
    const html = `<head>
      <link rel="mask-icon" href="/mask.svg" color="#000">
      <link rel="icon" type="image/svg+xml" href="/icon.svg">
      <link rel="apple-touch-icon" href="/touch.png">
      <link rel="icon" sizes="16x16" href="/16.png">
      <link href='/32.png?v=1&amp;b=2' rel='shortcut icon' sizes='32x32'>
    </head>`;
    expect(iconLinks(html, "https://example.com/blog/")).toEqual(["https://example.com/32.png?v=1&b=2", "https://example.com/touch.png", "https://example.com/16.png"]);
    expect(iconLinks(`<link rel="icon" href="javascript:alert(1)">`, "https://example.com/")).toEqual([]);
  });

  it("reads an icon written into the page", () => {
    const href = `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`;
    expect(dataIcon(href)).toEqual(PNG);
    expect(dataIcon("data:image/png;base64,%%%")).toBeNull();
  });
});
