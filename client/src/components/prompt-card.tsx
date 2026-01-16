import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { MoreHorizontal, Clock, Square, Pencil, Trash2, Eye } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Prompt } from "@shared/schema";

interface PromptCardProps {
  prompt: Prompt;
  onToggle: (id: string, isActive: boolean) => void;
  onEdit: (prompt: Prompt) => void;
  onDelete: (id: string) => void;
  onSelect: (prompt: Prompt) => void;
  isSelected?: boolean;
  alertCount?: number;
}

export function PromptCard({
  prompt,
  onToggle,
  onEdit,
  onDelete,
  onSelect,
  isSelected = false,
  alertCount = 0,
}: PromptCardProps) {
  return (
    <Card
      className={`transition-all cursor-pointer ${
        isSelected ? "ring-2 ring-primary" : ""
      }`}
      onClick={() => onSelect(prompt)}
      data-testid={`prompt-card-${prompt.id}`}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2 space-y-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className={`w-2 h-2 rounded-full ${prompt.isActive ? "bg-green-500" : "bg-muted-foreground"}`} />
          <h3 className="font-medium text-sm truncate">{prompt.name}</h3>
        </div>
        <div className="flex items-center gap-2">
          {alertCount > 0 && (
            <Badge variant="destructive" className="text-xs">
              {alertCount}
            </Badge>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-prompt-menu-${prompt.id}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(prompt); }} data-testid={`button-edit-prompt-${prompt.id}`}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onSelect(prompt); }} data-testid={`button-view-prompt-${prompt.id}`}>
                <Eye className="h-4 w-4 mr-2" />
                View Region
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => { e.stopPropagation(); onDelete(prompt.id); }}
                className="text-destructive"
                data-testid={`button-delete-prompt-${prompt.id}`}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground line-clamp-2">
          {prompt.prompt}
        </p>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>Every {prompt.frequencySeconds}s</span>
            </div>
            {prompt.boundingBox && (
              <div className="flex items-center gap-1">
                <Square className="h-3 w-3" />
                <span>Region</span>
              </div>
            )}
          </div>
          <Switch
            checked={prompt.isActive ?? false}
            onCheckedChange={(checked) => {
              onToggle(prompt.id, checked);
            }}
            onClick={(e) => e.stopPropagation()}
            data-testid={`switch-prompt-active-${prompt.id}`}
          />
        </div>
      </CardContent>
    </Card>
  );
}
