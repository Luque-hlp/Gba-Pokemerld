# Sirve la aplicación como sitio estático. La imagen NO contiene ninguna ROM ni BIOS:
# cada usuario selecciona su propio archivo y se procesa solo en su navegador.
#   docker build -t gba-emulator .
#   docker run --rm -p 8080:80 gba-emulator      →  http://localhost:8080
FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html dev.html styles.css /usr/share/nginx/html/
COPY src /usr/share/nginx/html/src
EXPOSE 80
