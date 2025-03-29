# @reapi/mcp-openapi

A Model Context Protocol (MCP) server that loads and serves multiple OpenAPI specifications to enable LLM-powered IDE integrations. This server acts as a bridge between your OpenAPI specifications and LLM-powered development tools like Cursor and other code editors.

## Features

- Loads multiple OpenAPI specifications from a directory
- Exposes API operations and schemas through MCP protocol
- Enables LLMs to understand and work with your APIs directly in your IDE
- Supports dereferenced schemas for complete API context
- Maintains a catalog of all available APIs

## Installation

You can use this package directly with npx:

```bash
npx @reapi/mcp-openapi --dir /path/to/specs
```

Or install it globally:

```bash
npm install -g @reapi/mcp-openapi
reapi-mcp-openapi --dir /path/to/specs
```

## Usage

```bash
reapi-mcp-openapi [options]
```

### Options

- `-d, --dir <path>`: Directory containing your OpenAPI specification files (defaults to current directory)
- `--catalog-dir <path>`: Directory for storing the API catalog (defaults to '_catalog')
- `--dereferenced-dir <path>`: Directory for storing dereferenced specifications (defaults to '_dereferenced')
- `-h, --help`: Display help information
- `-V, --version`: Display version information

### OpenAPI Specification Requirements

1. Place your OpenAPI 3.x specifications in the target directory:
   - Supports both JSON and YAML formats
   - Files should have `.json`, `.yaml`, or `.yml` extensions
   - Scanner will automatically discover and process all specification files

2. Specification ID Configuration:
   - By default, the filename (without extension) is used as the specification ID
   - To specify a custom ID, add `x-spec-id` in the OpenAPI info object:
   ```yaml
   openapi: 3.0.0
   info:
     title: My API
     version: 1.0.0
     x-spec-id: my-custom-api-id  # Custom specification ID
   ```
   
   > **Important**: Setting a custom `x-spec-id` is crucial when working with multiple specifications that have:
   > - Similar or identical endpoint paths
   > - Same schema names
   > - Overlapping operation IDs
   >
   > The spec ID helps distinguish between these similar resources and prevents naming conflicts. For example:
   > ```yaml
   > # user-service.yaml
   > info:
   >   x-spec-id: user-service
   > paths:
   >   /users:
   >     get: ...
   > 
   > # admin-service.yaml
   > info:
   >   x-spec-id: admin-service
   > paths:
   >   /users:
   >     get: ...
   > ```
   > Now you can reference these endpoints specifically as `user-service/users` and `admin-service/users`

## How It Works

1. The server scans the specified directory for OpenAPI specification files
2. It processes and dereferences the specifications for complete context
3. Creates and maintains a catalog of all API operations and schemas
4. Exposes this information through the MCP protocol
5. IDE integrations can then use this information to:
   - Provide API context to LLMs
   - Enable intelligent code completion
   - Assist in API integration
   - Generate API-aware code snippets

## Examples

1. Start the server with default settings:
```bash
npx @reapi/mcp-openapi
```

2. Specify a custom directory containing your API specs:
```bash
npx @reapi/mcp-openapi --dir ./my-apis
```

3. Custom catalog and dereferenced directories:
```bash
npx @reapi/mcp-openapi --dir ./apis --catalog-dir _my_catalog --dereferenced-dir _my_dereferenced
```

## Requirements

- Node.js >= 16

## Integration

This server implements the Model Context Protocol, making it compatible with LLM-powered development tools. It's designed to work seamlessly with:

- Cursor IDE
- Other MCP-compatible code editors
- LLM-powered development tools

## Tools

1. `refresh-api-catalog`
   - Refresh the API catalog
   - Returns: Success message when catalog is refreshed

2. `get-api-catalog`
   - Get the API catalog, the catalog contains metadata about all openapi specifications, their operations and schemas
   - Returns: Complete API catalog with all specifications, operations, and schemas

3. `search-api-operations`
   - Search for operations across specifications
   - Inputs:
     - `query` (string): Search query
     - `specId` (optional string): Specific API specification ID to search within
   - Returns: Matching operations from the API catalog

4. `search-api-schemas`
   - Search for schemas across specifications
   - Inputs:
     - `query` (string): Search query
   - Returns: Matching schemas from the API catalog

5. `load-api-operation-by-operationId`
   - Load an operation by operationId
   - Inputs:
     - `specId` (string): API specification ID
     - `operationId` (string): Operation ID to load
   - Returns: Complete operation details

6. `load-api-operation-by-path-and-method`
   - Load an operation by path and method
   - Inputs:
     - `specId` (string): API specification ID
     - `path` (string): API endpoint path
     - `method` (string): HTTP method
   - Returns: Complete operation details

7. `load-api-schema-by-schemaName`
   - Load a schema by schemaName
   - Inputs:
     - `specId` (string): API specification ID
     - `schemaName` (string): Name of the schema to load
   - Returns: Complete schema details

## Roadmap

1. **Semantic Search**
   - Implement semantic search capabilities for API operations and schemas
   - Enable natural language queries to find relevant API endpoints
   - Improve search accuracy using embeddings and vector similarity

2. **Code Template Generation**
   - Add support for code templates based on API specifications
   - Generate boilerplate code for API integrations
   - Provide language-specific client code generation
   - Support multiple programming languages and frameworks

3. **Community Contributions**
   - Have ideas to improve the MCP OpenAPI server?
   - Want to add new features or enhance existing ones?
   - Submit your ideas through issues or pull requests
   - Join the discussion and help shape the future of API integration with LLMs

## Example Prompts in Cursor

Here are some example prompts you can use in Cursor IDE to interact with your APIs:

1. **Explore Available APIs**
   ```
   "Show me all available APIs in the catalog with their operations"
   "List all API specifications and their endpoints"
   ```

2. **API Operation Details**
   ```
   "Show me the details of the create pet API endpoint"
   "What are the required parameters for creating a new pet?"
   "Explain the response schema for the pet creation endpoint"
   ```

3. **Schema and Mock Data**
   ```
   "Generate mock data for the Pet schema"
   "Create a valid request payload for the create pet endpoint"
   "Show me examples of valid pet objects based on the schema"
   ```

4. **Code Generation**
   ```
   "Generate an Axios client for the create pet API"
   "Create a TypeScript interface for the Pet schema"
   "Write a React hook that calls the create pet endpoint"
   ```

5. **API Integration Assistance**
   ```
   "Help me implement error handling for the pet API endpoints"
   "Generate unit tests for the pet API client"
   "Create a service class that encapsulates all pet-related API calls"
   ```

6. **Documentation and Usage**
   ```
   "Show me example usage of the pet API with curl"
   "Generate JSDoc comments for the pet API client methods"
   "Create a README section explaining the pet API integration"
   ```

7. **Validation and Types**
   ```
   "Generate Zod validation schema for the Pet model"
   "Create TypeScript types for all pet-related API responses"
   "Help me implement request payload validation for the pet endpoints"
   ```

8. **API Search and Discovery**
   ```
   "Find all endpoints related to pet management"
   "Show me all APIs that accept file uploads"
   "List all endpoints that return paginated responses"
   ```

These prompts demonstrate how to leverage the MCP server's capabilities for API development. Feel free to adapt them to your specific needs or combine them for more complex tasks.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. 