# Base de conocimiento del chat

Esta carpeta contiene la fuente de memoria de la conversación.

## Archivo requerido

Coloca aquí el archivo exportado del chat:

`chat/Aniveersary.txt`

El servidor lo carga automáticamente y lo usa como fuente de consulta cuando el usuario escribe la palabra clave **SABES**.

## Formato esperado

El formato puede ser el exportado por WhatsApp, por ejemplo:

`12/11/2025, 08:14 - M: Pues no se amor`

`12/11/2025, 08:15 - R: Si por allí entre 35 - 50`

Las etiquetas se interpretan así:

- `R` = `river`
- `M` = `mavc`

## Comportamiento de SABES

Cuando un mensaje contiene `SABES` (sin importar mayúsculas/minúsculas), el servidor busca primero información relevante dentro de `Aniveersary.txt` y se la entrega al modelo junto con la pregunta.

La IA debe responder usando únicamente la información encontrada para los hechos del chat. Si no encuentra evidencia suficiente, debe decir que no lo sabe en lugar de inventarlo.

El resto de mensajes continúa funcionando como conversación normal con la personalidad seleccionada.
