import sharp from "sharp";
import type { FilterType } from "../models/entities.js";

export async function applyFilter(
  input: Buffer,
  filter: FilterType,
): Promise<Buffer> {
  let pipeline = sharp(input);

  switch (filter) {
    case "grayscale":
      pipeline = pipeline.grayscale();
      break;
    case "sepia":
      pipeline = pipeline.modulate({ saturation: 0.4 }).tint("#704214");
      break;
    case "sharpen":
      pipeline = pipeline.sharpen();
      break;
    default:
      throw new Error(`Unsupported filter: ${filter satisfies never}`);
  }

  return pipeline.toBuffer();
}
