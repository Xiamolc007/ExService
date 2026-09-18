# ExUI Scaling Rules for React Development

When building React components and content with ExUI, reuse its components, Tokens, and CSS variables. Use `rem` for scalable typography, spacing, icons, control dimensions, and ordinary radii, calibrated against a 16px root font size. In React inline styles, use rem strings for scalable lengths; numeric length values normally mean pixels. Keep intentional fixed effects such as `1px` borders, focus rings, and shadows in pixels, and preserve upstream pixel API contracts. Let the application own the root font size; components should inherit its scale and allow content to wrap or grow without clipping.

## Scale reference

Apply this optional policy once in the application's global CSS. The thresholds use viewport height in CSS pixels; ExUI does not apply them automatically.

```css
:root {
  font-size: 16px;
}

@media (min-height: 1440px) {
  :root {
    font-size: 21px;
  }
}

@media (min-height: 2160px) {
  :root {
    font-size: 32px;
  }
}
```
