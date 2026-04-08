import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="w-3.5 h-3.5 text-muted-foreground/50 hover:text-muted-foreground cursor-help inline-block ml-1.5 shrink-0" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        <p>{text}</p>
      </TooltipContent>
    </Tooltip>
  );
}
