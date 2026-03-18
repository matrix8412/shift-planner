import { ImageResponse } from "next/og";

export const runtime = "edge";

export const contentType = "image/png";

export const size = {
  width: 180,
  height: 180,
};

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          borderRadius: 44,
          background: "linear-gradient(160deg, #0d6b73 0%, #07373b 100%)",
          color: "#f5fbfb",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Segoe UI",
          fontSize: 76,
          fontWeight: 800,
        }}
      >
        PO
      </div>
    ),
    size,
  );
}
