import { submitModelGeneration } from "@/lib/model-jobs";

export function POST(request: Request) {
  return submitModelGeneration(request);
}
