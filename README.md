# Chat with ourselves

Una app de chat con IA que simula el estilo de texto de "R" o "M", como regalo
de aniversario. El usuario elige con quién quiere hablar y chatea en tiempo
real con una IA que imita las muletillas, emojis y forma de escribir de esa
persona (basado en un análisis de estilo, no en mensajes reales copiados).

Usa la **API gratuita de Groq** — no necesitas tarjeta ni pagar nada.

## Qué incluye

- `server.js` — servidor Express con un endpoint `/api/chat` que llama a la
  API gratuita de Groq (modelos Llama) con el "perfil de estilo" de R o M.
- `personas.js` — la descripción del estilo de texto de cada persona
  (muletillas, emojis favoritos, longitud típica de mensaje, tono).
- `public/index.html` — el frontend: pantalla de carga con tu logo,
  selector de persona, y la interfaz de chat. Usa tu paleta de marca
  (negro `#050505`, blanco `#f2f2f0`, verde `#57a559`).
- `public/logo.jpg` — tu logo, usado en la pantalla de carga y el favicon.

