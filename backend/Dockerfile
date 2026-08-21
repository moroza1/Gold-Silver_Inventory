# Build stage
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copy project files
COPY PMIMS.WebAPI/*.csproj ./PMIMS.WebAPI/
COPY PMIMS.Application/*.csproj ./PMIMS.Application/
COPY PMIMS.Domain/*.csproj ./PMIMS.Domain/
COPY PMIMS.Infrastructure/*.csproj ./PMIMS.Infrastructure/

# Restore dependencies
RUN dotnet restore PMIMS.WebAPI/PMIMS.WebAPI.csproj

# Copy all source files
COPY . ./

# Build the application
RUN dotnet build PMIMS.WebAPI/PMIMS.WebAPI.csproj -c Release -o /app/build

# Publish stage
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS publish
WORKDIR /src
COPY --from=build /app/build .
RUN dotnet publish PMIMS.WebAPI/PMIMS.WebAPI.csproj -c Release -o /app/publish

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=publish /app/publish .

EXPOSE 5000
EXPOSE 5001

ENV ASPNETCORE_URLS=http://+:5000;https://+:5001
ENV ASPNETCORE_ENVIRONMENT=Production

ENTRYPOINT ["dotnet", "PMIMS.WebAPI.dll"]
