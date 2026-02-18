import { useForm } from "react-hook-form";
import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { Prompt, BoundingBox } from "@shared/schema";

const promptFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  prompt: z.string().min(10, "Prompt must be at least 10 characters"),
  frequencySeconds: z.number().min(5).max(300),
  isActive: z.boolean(),
  useBoundingBox: z.boolean(),
});

type PromptFormData = z.infer<typeof promptFormSchema>;

interface PromptFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    name: string;
    prompt: string;
    frequencySeconds: number;
    isActive: boolean;
    boundingBox: BoundingBox | null;
  }) => void;
  editPrompt?: Prompt | null;
  boundingBox?: BoundingBox | null;
  videoSourceId?: string;
}

export function PromptForm({
  open,
  onOpenChange,
  onSubmit,
  editPrompt,
  boundingBox,
}: PromptFormProps) {
  const form = useForm<PromptFormData>({
    resolver: zodResolver(promptFormSchema),
    defaultValues: {
      name: "",
      prompt: "",
      frequencySeconds: 60,
      isActive: true,
      useBoundingBox: false,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: editPrompt?.name ?? "",
        prompt: editPrompt?.prompt ?? "",
        frequencySeconds: editPrompt?.frequencySeconds ?? 60,
        isActive: editPrompt?.isActive ?? true,
        useBoundingBox: editPrompt?.boundingBox != null || boundingBox != null,
      });
    }
  }, [open, editPrompt, boundingBox, form]);

  const handleSubmit = (data: PromptFormData) => {
    onSubmit({
      name: data.name,
      prompt: data.prompt,
      frequencySeconds: data.frequencySeconds,
      isActive: data.isActive,
      boundingBox: data.useBoundingBox ? (boundingBox || editPrompt?.boundingBox || null) : null,
    });
    form.reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editPrompt ? "Edit Detection Rule" : "Create Detection Rule"}</DialogTitle>
          <DialogDescription>
            Configure a prompt that will be analyzed against the video feed at regular intervals.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rule Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., Package Detection"
                      {...field}
                      data-testid="input-prompt-name"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="prompt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Detection Prompt</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe what you want the AI to look for in the video..."
                      className="min-h-[100px] resize-none"
                      {...field}
                      data-testid="input-prompt-text"
                    />
                  </FormControl>
                  <FormDescription>
                    Be specific about what conditions should trigger an alert.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="frequencySeconds"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Check Frequency: {field.value} seconds</FormLabel>
                  <FormControl>
                    <Slider
                      min={5}
                      max={300}
                      step={5}
                      value={[field.value]}
                      onValueChange={([value]) => field.onChange(value)}
                      data-testid="slider-frequency"
                    />
                  </FormControl>
                  <FormDescription>
                    How often to analyze the video feed.
                  </FormDescription>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="useBoundingBox"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Use Region of Interest</FormLabel>
                    <FormDescription>
                      {boundingBox || editPrompt?.boundingBox
                        ? "Analyze only the selected region"
                        : "Draw a region on the video first"}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!boundingBox && !editPrompt?.boundingBox}
                      data-testid="switch-use-bounding-box"
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Enable Rule</FormLabel>
                    <FormDescription>
                      Start analyzing immediately after saving
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="switch-prompt-enabled"
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                data-testid="button-cancel-prompt"
              >
                Cancel
              </Button>
              <Button type="submit" data-testid="button-save-prompt">
                {editPrompt ? "Update Rule" : "Create Rule"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
