declare module "qrcode" {
  export function toCanvas(canvas: HTMLCanvasElement, text: string, opts?: { width?: number; margin?: number; color?: { dark?: string; light?: string } }): Promise<void>;
  export function toDataURL(text: string, opts?: { width?: number; margin?: number }): Promise<string>;
}
