export type FilterType = "grayscale" | "sepia" | "sharpen";

export interface UploadImageResponse {
  imageId: number;
  status: "processed";
  processedUrl: string;
  originalS3Key: string;
  processedS3Key: string;
}

export interface ApiErrorBody {
  error: string;
}
