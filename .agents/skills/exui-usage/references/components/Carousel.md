# Carousel

## Import

```tsx
import { type CarouselApi, Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `type CarouselApi`
- `Carousel`
- `CarouselContent`
- `CarouselItem`
- `CarouselPrevious`
- `CarouselNext`
- `useCarousel`

## Usage

```tsx
import { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext } from "@exre/exui"
import "@exre/exui/style.css"

export function ImageCarousel() {
  return (
    <Carousel className="w-full max-w-xs">
      <CarouselContent>
        <CarouselItem>Slide one</CarouselItem>
        <CarouselItem>Slide two</CarouselItem>
        <CarouselItem>Slide three</CarouselItem>
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  )
}
```

`CarouselPrevious` and `CarouselNext` disable themselves at the ends of the track and must stay inside `Carousel`. The same applies to `useCarousel()` — it throws outside a `Carousel` and returns `{ carouselRef, api, scrollPrev, scrollNext, canScrollPrev, canScrollNext }` for custom controls.

`Carousel` accepts:

- `orientation`: `"horizontal"` (default) or `"vertical"`.
- `opts`: Embla carousel options, such as `{ loop: true }` or `{ align: "start" }`.
- `plugins`: Embla plugins.
- `setApi`: a callback that receives the `CarouselApi` instance for programmatic control (scrolling, events, selected index).

For advanced props, use the TypeScript types exposed by the package-root import.
