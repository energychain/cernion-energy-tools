# Changelog

All notable changes to the Cernion Energy Tools project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-02-18

### Added
- **Renewable Energy Generation Forecast Service** - New forecast microservice for weather-based renewable energy generation forecasting
  - Weather-based generation forecasts using real MaStR installation data
  - IEC standard compliance (IEC 61853 for solar, IEC 61400 for wind)
  - Hourly forecasts up to 7 days (168 hours)
  - Regional filtering (state, district, municipality, postal code)
  - Installation-level breakdown available
  - Weather data integration via Visual Crossing API
  - Use cases: Energy procurement optimization, grid congestion analysis, VPP trading
  - Endpoint: `POST /api/forecast/generation-forecast`
  - CSV/XLSX export support with metadata
  - Full OpenAPI documentation with 7 request examples
  - 47 comprehensive tests (16 unit + 11 integration + 20 export tests)

- **XLSX Export Support for Assets Service** - Download asset data as Excel spreadsheets
  - All 7 asset endpoints now support `format=xlsx` parameter in addition to CSV and JSON
  - Automatic column width adjustment for better readability
  - Proper Excel MIME types and download headers
  - Works with all asset types: solar, wind, storage, biomass, hydro, combustion, all
  - Multi-sheet workbooks with formatted headers
  - Example: `GET /api/assets/solar?vnbName=Netze BW&format=xlsx`

- **CSV/XLSX Export for Forecast Service** - Download generation forecasts in multiple formats
  - Added `format` parameter (json, csv, xlsx) to forecast endpoint
  - CSV format includes metadata comments (location, installation type, capacity)
  - XLSX format includes two sheets: Forecast data + Metadata sheet
  - Consistent export interface across all data-heavy services
  - Content-Type headers and automatic file download support

### Changed
- **Test Coverage Improvements** - Added 31 new tests across forecast and export functionality
  - Total test count: 255 tests across 21 test suites
  - Code coverage: 79.13% overall
  - 100% test pass rate

### Dependencies
- Added `xlsx` (SheetJS) library for Excel file generation

## [0.4.1] - 2026-02-13

### Fixed
- **Comprehensive MaStR Field Mapping** - Assets service now captures ALL fields from MaStR data
  - Fixed missing `C_Rate` for storage installations (now checks 4 field name variants for storage capacity)
  - Fixed missing `Marktakteur Name` (now checks 4 field name variants including `nameMarktakteur` and `marktakteurFirmenname`)
  - Enhanced capacity field mapping for storage (now checks `acLeistung`, `bruttoleistung`, `nettonennleistung`, `installierteleistung`)
  - All field mappings now handle both German and English field name variants from MCP

### Added
- **60+ Comprehensive MaStR Fields** - Complete dataset now available for all asset types:
  - **Core Identification**: EinheitMastrNummer, Einheit Systemstatus
  - **Grid Operator Info**: Netzbetreiber MaStR, Netzbetreiber Name
  - **Enhanced Power Specs**: Added separate kW field alongside MW, AC/DC Nennleistung for storage
  - **Storage-Specific**: Batterietechnologie, Hersteller Batteriemodule, AC/DC Nennleistung
  - **Solar-Specific**: Hauptausrichtung (orientation), Neigungswinkel (tilt), Leistungsbegrenzung, Anzahl Module, Leistung je Modul
  - **Wind-Specific**: Nabenhöhe (hub height), Rotordurchmesser (rotor diameter), Hersteller, Typenbezeichnung
  - **Dates**: Registrierungsdatum, Genehmigungsdatum (in addition to commissioning date)
  - **Grid Connection**: Spannungsebene (voltage level), Fernsteuerbarkeit (remote control), Einsatzverantwortlicher
  - **Location**: Längengrad (longitude), Breitengrad (latitude), complete address data
  - **Additional**: Fläche (used area in m²)

### Changed
- **Robust Field Detection** - All field mappings now check multiple name variants to ensure no data loss
- **OpenAPI Schema Updated** - Swagger documentation now includes all 60+ fields with proper types, descriptions, and nullability
- **Asset-Type Aware** - Fields are appropriately marked as type-specific (e.g., solar-only, wind-only, storage-only)

### Technical Details
- Enhanced field mapping in assets.service.js with comprehensive fallback chains
- Storage capacity calculation now checks: `storageCapacityKWh`, `nutzbareSpeicherkapazitaet`, `speicherkapazitaet`, `nutzbareKapazitaet`
- Power capacity checks: `capacityKW`, `acLeistung`, `bruttoleistung`, `nettonennleistung`, `installierteleistung`
- Marktakteur name checks: `marketActorName`, `marktakteurName`, `nameMarktakteur`, `marktakteurFirmenname`
- All OpenAPI property definitions updated with proper types and descriptions
- Maintains backward compatibility - all previously available fields still work

## [0.4.0] - 2026-02-13

### Added
- **CSV Export** - All asset endpoints now support CSV download format
  - Add `format=csv` query parameter to any `/api/assets/*` endpoint
  - Automatically sets proper response headers (`Content-Type: text/csv`, `Content-Disposition: attachment`)
  - CSV includes all fields including new operational status fields
  - Works with all filters (location, operationalStatus, minCapacityKW, etc.)
  - Available for all endpoints: list, solar, wind, storage, biomass, hydro, combustion, all

- **Operational Status Filtering** - Smart filtering by installation operational status
  - **Default behavior**: Only returns active installations (status 35 - "In Betrieb")
  - Override with `operationalStatus` parameter: `35` (active), `38` (decommissioned), `all`, or comma-separated
  - Reduces noise in results - most users only need active installations
  - Status codes: 31=Planned, 35=In operation, 37=Temporarily decommissioned, 38=Permanently decommissioned
  - Applies to all asset endpoints

- **Status Fields in Output** - Installation operational status now visible in API responses
  - `Betriebsstatus`: Status code (e.g., "35")
  - `Betriebsstatus Name`: German status name (e.g., "In Betrieb")
  - Allows users to verify filter behavior and understand installation state
  - Included in both JSON and CSV output formats

- **Cernion Token as Request Parameter** - Flexible authentication options
  - Pass Cernion MCP token as query parameter: `?token=YOUR_TOKEN`
  - Alternative to Bearer token header authentication
  - Overrides `CERNION_TOKEN` environment variable for the request
  - Enables easy browser testing and multi-tenant scenarios
  - Documented in OpenAPI specification

### Changed
- **Breaking**: Default behavior change for asset endpoints
  - Now returns only active installations (status 35) by default
  - Previous behavior (all statuses): Use `operationalStatus=all`
  - Rationale: Most users only need active installations; decommissioned units create noise
  - Easy to override for users who need all installations

### Technical Details
- CSV conversion with proper escaping and UTF-8 encoding
- Client-side operational status filtering after MCP tool call with stats recalculation
- Field mapping includes status extraction from `einheitBetriebsstatus` with German name mapping
- OpenAPI documentation fully updated with new parameters and response formats
- Response header manipulation for CSV download behavior

## [0.3.1] - 2026-02-12

### Fixed
- **Assets Service** - Location parameter now correctly passed to MCP tool for postal code filtering
- **Assets Service** - Fixed validation error when using gridOperatorId without location parameter
- **Energy Market Service** - Added postleitzahl parameter support for precise location filtering
- Parameter handling: postleitzahl only set when location is actually provided (prevents validation errors)

### Technical Details
- Bug 1: energy-market.service.js was accepting location parameter but not forwarding it to MCP tool
- Bug 2: assets.service.js was always setting postleitzahl even when undefined, causing validation failure
- Both fixes apply to all asset types (solar, wind, storage, biomass, hydro, combustion)

## [0.3.0] - 2026-02-11

### Added
- **Assets Service** - Complete grid operator asset management service
  - Retrieve all installations from German Marktstammdatenregister (MaStR) for a distribution network operator
  - Support for all installation types: solar, wind, storage, biomass, hydro, combustion
  - VNB filtering by BDEW code, MaStR grid operator ID, or operator name
  - Redispatch 2.0 filter (installations ≥100kW)
  - No pagination required - can retrieve millions of installations
  - Type-specific endpoints: `/api/assets/solar`, `/api/assets/wind`, `/api/assets/storage`, etc.
  - Combined endpoint: `/api/assets/all` with optional type selection
- VNB/DSO lookup endpoints for grid operator discovery
- BDEW → MaStR grid operator ID resolution
- MaStR installation filters for grid operator identification

### Changed
- Moved assets service from custom-services to core services directory
- OpenAPI documentation fully translated to English for international compatibility
- Expanded OpenAPI documentation with detailed descriptions, examples, and error responses
- Grid operator analysis/export accepts BDEW/MaStR identifiers in addition to names

### Fixed
- VNB filtering now works for all installation types (solar, wind, storage, biomass, combustion)
- Removed workaround code that restricted VNB filtering to storage-only after MaStR database update

### Testing
- Added comprehensive test coverage for assets service
- Integration tests for VNB filtering across all installation types

## [0.2.0] - 2026-02-07

### Added
- Custom service and test directories for local extensions (custom-services/, custom-tests/)
- Creator CLI support for iterative updates, catalog-aware generation, and optional live MCP integration tests
- Test helper script for custom services (`npm run test:custom`)
- Hot reload and runtime loading for both core and custom services

### Changed
- Service creator now resolves Gemini model availability and falls back to supported models
- Creator and runtime guidance updated for OpenAPI coverage and ctx.call orchestration

### Fixed
- Normalized CO₂ intensity forecast response shape to align with MCP tool data
- Improved resilience when mapping forecast arrays from MCP responses

## [0.1.0] - 2026-02-07

### Added
- Initial release of Cernion Energy Tools MicroService Agent System
- 11 microservices covering energy market operations
  - Query Tools Service (`query`) - Natural language queries and schema discovery
  - Energy Market Data Service (`energy-market`) - Prices, production, forecasts
  - Grid Operations Service (`grid-operations`) - Network data, redispatch, capacity analysis
  - Business Intelligence Service (`business-intelligence`) - Market analysis, lead generation
  - Customer Service Service (`customer-service`) - Self-service widgets, health checks
  - ENTSO-E Service (`entsoe`) - European energy data from ENTSO-E Transparency Platform
  - Gas Storage Service (`gas-storage`) - European gas storage monitoring (AGSI)
  - EIC Codes Service (`eic-codes`) - Energy Identification Code management
  - German Grid Service (`german-grid`) - German grid operator data (Netztransparenz.de)
  - System Service (`system`) - Status, job management, token management
  - API Gateway Service (`api`) - REST API with OpenAPI documentation
- 70+ MCP tools mapped to REST endpoints
- Moleculer-based microservices architecture
- MCP (Model Context Protocol) SDK integration
- Async job polling for long-running operations
- OpenAPI/Swagger documentation at `/api/docs`
- CLI tool for calling microservices
- Service creation tool for scaffolding new services
- Comprehensive test suite with Jest
- ESLint and Prettier code quality tools
- Hot reload support for development
- Bearer token authentication support
- Automatic OpenAPI schema generation

### Documentation
- Complete README.md with quick start guide
- MCP_TOOLS.md - Developer documentation for 70+ energy data tools
- MCP_SERVICES.md - Microservices architecture documentation
- QUICKSTART.md - Quick start guide for developers
- CONTRIBUTING.md - Contribution guidelines
- ASYNC_JOB_POLLING.md - Async job polling documentation
- BEARER_TOKEN_AUTHENTICATION.md - Authentication guide
- API documentation via Swagger UI

### Testing
- Unit tests for all microservices
- Tests for MCP client and async job poller
- Test coverage reporting with Jest
- 100% service coverage with test files

### Configuration
- Environment variable configuration via `.env`
- Moleculer configuration for distributed systems
- Support for NATS, Redis, MQTT transporters
- Configurable caching (Memory, Redis)
- Google Gemini AI integration
- Cernion MCP token authentication

## [Unreleased]

### Planned
- Additional European energy market integrations
- Real-time WebSocket support for streaming data
- Enhanced caching strategies
- Performance optimization for high-volume queries
- Extended test coverage with integration tests
- Docker containerization support
- Kubernetes deployment configurations
- CI/CD pipeline setup
- Rate limiting and throttling

---

## Release Notes

### v0.1.0 - Initial Release

This is the first public release of Cernion Energy Tools, providing a comprehensive microservices platform for energy market data analysis and operations. The system integrates with multiple data sources including:

- **MaStR** (Marktstammdatenregister) - German registry of energy installations
- **ENTSO-E** Transparency Platform - European electricity grid data
- **SMARD.de** - German electricity market data
- **AGSI** - European gas storage data
- **Netztransparenz.de** - German grid operator data
- **GrünstromIndex** - Regional CO₂ intensity forecasts

The platform supports both direct API queries and natural language queries powered by AI, making energy data accessible to both technical and non-technical users.

### Key Features in v0.1.0

1. **REST API First**: All functionality exposed via REST endpoints
2. **OpenAPI Documentation**: Auto-generated Swagger documentation
3. **Bearer Token Auth**: Support for Cernion MCP tokens
4. **Async Jobs**: Long-running queries return job IDs for polling
5. **Multi-Format Dates**: ISO 8601, YYYYMMDD, German format (DD.MM.YYYY)
6. **Comprehensive Statistics**: Most endpoints include statistical summaries
7. **EIC Code Resolution**: Automatic European energy code resolution
8. **Template Learning**: Self-learning query system for 20x faster repeated queries

### Breaking Changes
None - initial release

### Migration Guide
Not applicable - initial release

### Deprecations
None - initial release
