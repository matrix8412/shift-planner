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
          fontFamily: "Segoe UI",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 16,
            borderRadius: 40,
            border: "4px solid rgba(255,255,255,0.16)",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
          <div style={{ fontSize: 78, fontWeight: 800, lineHeight: 1 }}>PO</div>
          <div style={{ fontSize: 18, letterSpacing: 4, textTransform: "uppercase", opacity: 0.82 }}>Schedule</div>
        </div>
      </div>
    ),
    {
      width: 192,
      height: 192,
    },
  );
}
