import { describe, expect, it } from "vitest";
import { figmaFrame, figmaImageHost, figmaShot, pictureType, shotUrl } from "./figma";

const KEY = "AbCdEfGhIjKlMnOpQrStUv12";

describe("a Figma frame as a step's picture", () => {
  it("reads the frame a link names, a branch's as the branch, and nothing without one frame", () => {
    expect(figmaFrame(`https://www.figma.com/design/${KEY}/Checkout?node-id=12-34&t=abc&m=dev`)).toEqual({ fileKey: KEY, nodeId: "12:34", url: `https://www.figma.com/design/${KEY}/Checkout?node-id=12-34` });
    expect(figmaFrame(`https://figma.com/file/${KEY}/Old?node-id=1%3A2`)?.nodeId).toBe("1:2");
    expect(figmaFrame(`https://www.figma.com/design/${KEY}/branch/ZyXwVuTsRqPoNmLkJiHg9876/Checkout?node-id=5-6`)?.fileKey).toBe("ZyXwVuTsRqPoNmLkJiHg9876");
    expect(figmaFrame(`https://www.figma.com/design/${KEY}/Checkout`)).toBeNull();
    expect(figmaFrame(`https://www.figma.com/board/${KEY}/Map?node-id=1-2`)).toBeNull();
    expect(figmaFrame(`http://www.figma.com/design/${KEY}/x?node-id=1-2`)).toBeNull();
    expect(figmaFrame(`https://figma.com.evil.test/design/${KEY}/x?node-id=1-2`)).toBeNull();
    expect(figmaFrame("not a link")).toBeNull();
  });

  it("asks for the frame's picture as an address, and keeps the answer only for that frame", () => {
    expect(figmaShot(figmaFrame(`https://www.figma.com/design/${KEY}/x?node-id=12-34`)!)).toEqual({ tool: "get_screenshot", args: { fileKey: KEY, nodeId: "12:34", maxDimension: 1600 }, match: ["fileKey", "nodeId"] });
  });

  it("finds the picture's address in Figma's answer, on Figma's hosts only", () => {
    const answer = [
      JSON.stringify({ width: 780, height: 1600, original_width: 390, original_height: 800 }),
      `Screenshot of https://www.figma.com/design/${KEY}/x?node-id=12-34 is ready.`,
      'Download it: curl -o shot.png "https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/7c1f-uuid?X-Amz-Signature=abc&X-Amz-Expires=600".',
    ].join("\n");
    expect(shotUrl(answer)).toBe("https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/7c1f-uuid?X-Amz-Signature=abc&X-Amz-Expires=600");
    expect(shotUrl(JSON.stringify({ url: "https://mcp.figma.com/screenshots/abc.png?sig=1&2" }))).toBe("https://mcp.figma.com/screenshots/abc.png?sig=1&2");
    expect(shotUrl("curl https://evil.test/shot.png and https://figma-alpha-api.s3.amazonaws.com.evil.test/x.png")).toBeNull();
    expect(shotUrl(`Only the file: https://www.figma.com/design/${KEY}/x?node-id=1-2`)).toBeNull();
    expect(figmaImageHost("s3-alpha.figma.com")).toBe(true);
    expect(figmaImageHost("notfigma.com")).toBe(false);
  });

  it("tells a picture by its first bytes", () => {
    expect(pictureType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(pictureType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(pictureType(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("image/webp");
    expect(pictureType(new TextEncoder().encode("<html>AccessDenied</html>"))).toBeNull();
  });
});
