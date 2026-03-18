import { ImageResponse } from "next/og";

export const runtime = "edge";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          background: "linear-gradient(160deg, #0d6b73 0%, #07373b 100%)",
          color: "#f5fbfb",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          fontFamily: "Segoe UI",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 48,
            borderRadius: 112,
            border: "8px solid rgba(255,255,255,0.14)",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 18 }}>
          <div style={{ fontSize: 118, fontWeight: 800, lineHeight: 1 }}>PO</div>
          <div style={{ fontSize: 32, letterSpacing: 8, textTransform: "uppercase", opacity: 0.82 }}>Schedule</div>
        </div>
      </div>
    ),
    {
      width: 512,
      height: 512,
    },
  );
}
