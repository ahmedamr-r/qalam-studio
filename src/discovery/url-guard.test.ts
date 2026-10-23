import { describe, expect, it } from "vitest";
import { checkUrl, googleDocsExport, isBlockedAddress, readableType } from "./url-guard";

const ok = (u: string) => checkUrl(u).ok;

describe("isBlockedAddress", () => {
  it("blocks private, loopback, link-local and other special IPv4 ranges", () => {
    for (const ip of ["127.0.0.1", "127.255.0.9", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "192.0.2.5", "198.18.0.1", "224.0.0.1", "255.255.255.255", "240.0.0.1"])
      expect(isBlockedAddress(ip), ip).toBe(true);
  });

  it("lets public IPv4 addresses through, right next to the private ranges too", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "172.15.255.255", "172.32.0.1", "100.128.0.1", "11.0.0.1", "192.169.0.1"]) expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it("blocks IPv6 loopback, unspecified, unique-local, link-local, multicast and documentation addresses", () => {
    for (const ip of ["::1", "::", "[::1]", "fc00::1", "fd12:3456:789a::1", "fe80::1", "fe80::1%en0", "febf::1", "fec0::1", "ff02::1", "2001:db8::1", "2001::1", "100::1"]) expect(isBlockedAddress(ip), ip).toBe(true);
  });

  it("judges IPv4 inside IPv6 (mapped, NAT64, 6to4) by the IPv4 address", () => {
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:7f00:1")).toBe(true);
    expect(isBlockedAddress("::ffff:a9fe:a9fe")).toBe(true);
    expect(isBlockedAddress("::ffff:8.8.8.8")).toBe(false);
    expect(isBlockedAddress("64:ff9b::10.0.0.1")).toBe(true);
    expect(isBlockedAddress("64:ff9b::8.8.8.8")).toBe(false);
    expect(isBlockedAddress("2002:c0a8:0101::1")).toBe(true);
    expect(isBlockedAddress("2002:0808:0808::1")).toBe(false);
  });

  it("lets public IPv6 through, and blocks what doesn't parse", () => {
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedAddress("2a00:1450:4001:80b::200e")).toBe(false);
    for (const ip of ["not-an-ip", "1.2.3", "300.1.1.1", "1::2::3", "12345::1", ""]) expect(isBlockedAddress(ip), ip).toBe(true);
  });
});

describe("checkUrl", () => {
  it("takes public http(s) pages on the standard ports", () => {
    expect(ok("https://example.com/notes")).toBe(true);
    expect(ok("http://example.com")).toBe(true);
    expect(ok("https://example.com:443/a")).toBe(true);
    expect(ok("https://93.184.216.34/")).toBe(true);
  });

  it("refuses other schemes, credentials and other ports", () => {
    for (const u of ["file:///etc/passwd", "ftp://example.com/a", "gopher://example.com", "javascript:alert(1)", "data:text/html,hi", "https://user:pw@example.com/", "https://example.com:8080/", "http://example.com:22/", "not a url"]) expect(ok(u), u).toBe(false);
  });

  it("refuses local names and private addresses written any way the URL parser accepts", () => {
    for (const u of [
      "http://localhost/",
      "http://localhost./",
      "http://app.localhost/",
      "http://printer.local/",
      "http://db.internal/",
      "http://intranet/",
      "http://127.0.0.1/",
      "http://2130706433/",
      "http://0x7f.1/",
      "http://0177.0.0.1/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[fd00::1]/",
    ])
      expect(ok(u), u).toBe(false);
  });
});

describe("googleDocsExport", () => {
  it("reads a public Google Doc as plain text", () => {
    const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
    expect(googleDocsExport(new URL(`https://docs.google.com/document/d/${id}/edit?usp=sharing`)).href).toBe(`https://docs.google.com/document/d/${id}/export?format=txt`);
    expect(googleDocsExport(new URL(`https://docs.google.com/document/u/0/d/${id}/view`)).href).toBe(`https://docs.google.com/document/d/${id}/export?format=txt`);
    expect(googleDocsExport(new URL(`https://docs.google.com/document/d/${id}`)).href).toBe(`https://docs.google.com/document/d/${id}/export?format=txt`);
  });

  it("leaves published pages and everything else as they are", () => {
    const pub = new URL("https://docs.google.com/document/d/e/2PACX-1vSomethingPublished/pub");
    expect(googleDocsExport(pub)).toBe(pub);
    const other = new URL("https://example.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWx/edit");
    expect(googleDocsExport(other)).toBe(other);
  });
});

describe("readableType", () => {
  it("takes pages, text, PDFs, Word documents and untyped files; not media", () => {
    for (const t of ["text/html; charset=utf-8", "text/plain", "text/markdown", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/octet-stream", ""]) expect(readableType(t), t).toBe(true);
    for (const t of ["image/png", "video/mp4", "audio/mpeg", "application/zip", "font/woff2"]) expect(readableType(t), t).toBe(false);
  });
});
