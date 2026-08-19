# Build stage
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy project files for layer caching
COPY ["PMIMS.Domain/PMIMS.Domain.csproj", "PMIMS.Domain/"]
COPY ["PMIMS.Application/PMIMS.Application.csproj", "PMIMS.Application/"]
COPY ["PMIMS.Infrastructure/PMIMS.Infrastructure.csproj", "PMIMS.Infrastructure/"]
COPY ["Ledger.Gl/Ledger.Gl.csproj", "Ledger.Gl/"]
COPY ["Ledger.Gl.EfCore/Ledger.Gl.EfCore.csproj", "Ledger.Gl.EfCore/"]
COPY ["PMIMS.WebAPI/PMIMS.WebAPI.csproj", "PMIMS.WebAPI/"]

# Restore dependencies
RUN dotnet restore "PMIMS.WebAPI/PMIMS.WebAPI.csproj"

# Copy all backend source files
COPY . .

# Publish API
WORKDIR "/src/PMIMS.WebAPI"
RUN dotnet publish "PMIMS.WebAPI.csproj" \
    -c Release \
    -o /app/publish \
    --no-restore

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app

ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "PMIMS.WebAPI.dll"]
