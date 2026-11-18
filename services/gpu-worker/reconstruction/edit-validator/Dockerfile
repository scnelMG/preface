FROM node:20.19.5-slim
WORKDIR /app
COPY engine/ engine/
COPY tools/auto_eye_limits.mjs tools/
COPY tools/audit_weight_shape.mjs tools/
COPY edit-validator/ edit-validator/
RUN node --input-type=module -e "await import('./edit-validator/validate-eye.mjs')"
USER node
EXPOSE 3001
CMD ["node", "edit-validator/server.mjs"]
