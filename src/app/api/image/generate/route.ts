import { submitTextToImage } from "@/lib/image-jobs";

export function POST(request: Request) {
  return submitTextToImage(request);
}
