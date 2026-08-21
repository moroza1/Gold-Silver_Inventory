# Build stage
FROM node:20-alpine AS build
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . ./

# Build the application
RUN npm run build

# Runtime stage
FROM node:20-alpine
WORKDIR /app

# Install serve to run the frontend
RUN npm install -g serve

# Copy built application from build stage
COPY --from=build /app/dist ./dist

EXPOSE 3000

# Serve the application
CMD ["serve", "-s", "dist", "-l", "3000"]
