FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies first for better caching
COPY package.json package-lock.json* ./
RUN npm ci

# Copy the rest of the application
COPY . .

# Build the Next.js app
RUN npm run build

# Expose the listening port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
# 指向掛載的授權檔案路徑
ENV PI_AUTH_JSON_PATH=/app/auth-data/auth.json

# Start the application
CMD ["npm", "start"]
