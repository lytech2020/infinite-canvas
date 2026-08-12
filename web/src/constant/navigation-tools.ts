import { ImagePlus, Images, Maximize2, Video } from "lucide-react";

export const navigationTools = [
    {
        slug: "canvas",
        labelKey: "tools.canvas",
        icon: Maximize2,
    },
    {
        slug: "image",
        labelKey: "tools.image",
        icon: ImagePlus,
    },
    {
        slug: "video",
        labelKey: "tools.video",
        icon: Video,
    },
    {
        slug: "assets",
        labelKey: "tools.assets",
        icon: Images,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
