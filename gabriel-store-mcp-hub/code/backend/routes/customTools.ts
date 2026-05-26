import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Docker from 'dockerode';
import type { McpRecord } from '../types/mcp.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateCustomToolDefinition,
  generateCustomMcpCode,
  generateDockerfile,
  type CustomToolDefinition,
} from '../services/customToolsGenerator.js';

interface CustomToolsRouteOptions {
  docker: Docker;
  loadData: () => McpRecord;
  saveData: (data: McpRecord) => void;
  mcpLabel: string;
}

interface DeployCustomToolResponse {
  success: boolean;
  containerId?: string;
  containerName?: string;
  message: string;
  error?: string;
}

export function registerCustomToolsRoutes(
  fastify: FastifyInstance,
  options: CustomToolsRouteOptions
): void {
  const { docker, loadData, saveData, mcpLabel } = options;

  /**
   * POST /api/custom-tools/validate
   * Validates a custom tool definition without deploying
   */
  fastify.post<{ Body: CustomToolDefinition }>(
    '/api/custom-tools/validate',
    async (req: FastifyRequest<{ Body: CustomToolDefinition }>, reply: FastifyReply) => {
      const definition = req.body;

      const validation = validateCustomToolDefinition(definition);

      if (!validation.valid) {
        return reply.code(400).send({
          valid: false,
          errors: validation.errors,
        });
      }

      return reply.send({
        valid: true,
        errors: [],
        message: 'Custom tool definition is valid',
      });
    }
  );

  /**
   * POST /api/custom-tools/generate
   * Generates the JavaScript code without deploying
   */
  fastify.post<{ Body: CustomToolDefinition }>(
    '/api/custom-tools/generate',
    async (req: FastifyRequest<{ Body: CustomToolDefinition }>, reply: FastifyReply) => {
      const definition = req.body;

      const validation = validateCustomToolDefinition(definition);
      if (!validation.valid) {
        return reply.code(400).send({
          error: 'Invalid definition',
          errors: validation.errors,
        });
      }

      try {
        const jsCode = generateCustomMcpCode(definition);
        const dockerfile = generateDockerfile();

        return reply.send({
          success: true,
          jsCode,
          dockerfile,
          definition,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[customTools] Error generating code:', message);
        return reply.code(500).send({
          error: 'Failed to generate code',
          message,
        });
      }
    }
  );

  /**
   * POST /api/custom-tools/deploy
   * Generates, builds Docker image, and deploys the custom MCP
   */
  fastify.post<{ Body: CustomToolDefinition }>(
    '/api/custom-tools/deploy',
    async (
      req: FastifyRequest<{ Body: CustomToolDefinition }>,
      reply: FastifyReply
    ) => {
      const definition = req.body;

      const validation = validateCustomToolDefinition(definition);
      if (!validation.valid) {
        return reply.code(400).send({
          success: false,
          message: 'Invalid definition',
          error: validation.errors.join('; '),
        });
      }

      const tmpDir = join(tmpdir(), `custom-mcp-${Date.now()}`);
      let container: Docker.Container | null = null;

      try {
        // Create temporary directory with source files
        mkdirSync(tmpDir, { recursive: true });
        console.error(`[customTools] Created temp dir: ${tmpDir}`);

        const port = definition.port ?? 8000;
        const jsCode = generateCustomMcpCode(definition);
        const dockerfile = generateDockerfile(port);

        writeFileSync(join(tmpDir, 'server.js'), jsCode);
        writeFileSync(join(tmpDir, 'Dockerfile'), dockerfile);
        console.error('[customTools] Generated server.js and Dockerfile');

        // Build Docker image
        const imageName = `custom-mcp-${definition.name
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')}-${Date.now()}`;
        const imageTag = `${imageName}:latest`;

        console.error(`[customTools] Building Docker image: ${imageTag}`);

        // Stream build output
        const buildStream = await docker.buildImage(
          {
            context: tmpDir,
            src: ['server.js', 'Dockerfile'],
          },
          { t: imageTag }
        );

        await new Promise((resolve, reject) => {
          docker.modem.followProgress(buildStream, (err) => {
            if (err) reject(err);
            else resolve(null);
          });
        });

        console.error(`[customTools] Docker image built successfully: ${imageTag}`);

        // Create container
        const containerName = `custom-mcp-${definition.name
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')}-${Date.now()}`;

        const portStr = `${port}/tcp`;

        container = await docker.createContainer({
          Image: imageTag,
          name: containerName,
          ExposedPorts: {
            [portStr]: {},
          },
          HostConfig: {
            PortBindings: {
              [portStr]: [{ HostPort: String(port) }],
            },
            Binds: [
              'shared-data:/shared-data',
              '/var/run/docker.sock:/var/run/docker.sock',
            ],
          },
          Labels: {
            [mcpLabel]: 'true',
          },
          Env: [
            `PORT=${port}`,
            'NODE_ENV=production',
          ],
        });

        const containerId = container.id.slice(0, 12);
        console.error(`[customTools] Container created: ${containerId}`);

        // Start container
        await container.start();
        console.error(`[customTools] Container started: ${containerId}`);

        // Create shared volume directories if they don't exist
        if (definition.sharedVolumeAccess && definition.sharedVolumeAccess.length > 0) {
          try {
            for (const access of definition.sharedVolumeAccess) {
              const folderPath = access.folder;
              if (folderPath) {
                // Execute mkdir command inside the container
                const exec = await container.exec({
                  Cmd: ['mkdir', '-p', folderPath],
                  AttachStdout: true,
                  AttachStderr: true,
                });
                await exec.start({ Detach: false });
                console.error(`[customTools] Created shared volume directory: ${folderPath}`);
              }
            }
          } catch (err) {
            console.error(`[customTools] Warning: Failed to create shared volume directories:`, err instanceof Error ? err.message : String(err));
            // Don't fail the deployment if directory creation fails
          }
        }

        // Connect to network if it exists
        try {
          const network = docker.getNetwork('mcp-hub-network');
          await network.connect({ Container: container.id });
          console.error(`[customTools] Connected container to mcp-hub-network`);
        } catch (err) {
          console.error(`[customTools] Failed to connect to network:`, err instanceof Error ? err.message : String(err));
        }

        // Save metadata
        const data = loadData();

        data[containerId] = {
          name: definition.name,
          image: imageTag,
          command: 'node /app/server.js',
          env: {
            PORT: String(port),
          },
          port,
          transport: 'http',
          isCustomToolsMcp: true,
          containerName,
          customToolDefinition: definition as unknown as Record<string, unknown>, // Store definition for future reference
        };

        saveData(data);
        console.error(`[customTools] Metadata saved for ${containerId}`);

        return reply.code(201).send({
          success: true,
          containerId,
          containerName,
          message: `Custom MCP "${definition.name}" deployed successfully`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[customTools] Deployment failed:', message);

        // Attempt cleanup
        if (container) {
          try {
            await container.stop();
            await container.remove();
            console.error('[customTools] Cleaned up failed container');
          } catch (cleanupErr) {
            console.error('[customTools] Cleanup error:', cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr));
          }
        }

        return reply.code(500).send({
          success: false,
          message: 'Failed to deploy custom MCP',
          error: message,
        });
      } finally {
        // Cleanup temp directory
        try {
          rmSync(tmpDir, { recursive: true, force: true });
          console.error(`[customTools] Cleaned up temp directory: ${tmpDir}`);
        } catch (err) {
          console.error(`[customTools] Failed to cleanup temp dir:`, err instanceof Error ? err.message : String(err));
        }
      }
    }
  );

  /**
   * PUT /api/custom-tools/{containerId}
   * Updates an existing custom MCP (removes old, creates new)
   */
  fastify.put<{ Params: { containerId: string }; Body: CustomToolDefinition }>(
    '/api/custom-tools/:containerId',
    async (
      req: FastifyRequest<{ Params: { containerId: string }; Body: CustomToolDefinition }>,
      reply: FastifyReply
    ) => {
      const { containerId } = req.params;
      const definition = req.body;

      const validation = validateCustomToolDefinition(definition);
      if (!validation.valid) {
        return reply.code(400).send({
          success: false,
          message: 'Invalid definition',
          error: validation.errors.join('; '),
        });
      }

      const tmpDir = join(tmpdir(), `custom-mcp-${Date.now()}`);
      let newContainer: Docker.Container | null = null;

      try {
        // Get current MCP data to find old container details
        const data = loadData();
        const oldMcpData = data[containerId];
        if (!oldMcpData) {
          return reply.code(404).send({
            success: false,
            message: 'MCP not found',
            error: `No MCP found with ID ${containerId}`,
          });
        }

        // Stop and remove old container
        try {
          const oldContainer = docker.getContainer(containerId);
          const oldContainerInfo = await oldContainer.inspect().catch(() => null);
          if (oldContainerInfo) {
            try {
              await oldContainer.stop();
              console.error(`[customTools] Stopped old container: ${containerId}`);
            } catch (err) {
              console.error(`[customTools] Error stopping container:`, err instanceof Error ? err.message : String(err));
            }
            try {
              await oldContainer.remove();
              console.error(`[customTools] Removed old container: ${containerId}`);
            } catch (err) {
              console.error(`[customTools] Error removing container:`, err instanceof Error ? err.message : String(err));
            }
          }
        } catch (err) {
          console.error(`[customTools] Error cleaning up old container:`, err instanceof Error ? err.message : String(err));
        }

        // Create temporary directory with source files
        mkdirSync(tmpDir, { recursive: true });
        console.error(`[customTools] Created temp dir: ${tmpDir}`);

        const port = definition.port ?? 8000;
        const jsCode = generateCustomMcpCode(definition);
        const dockerfile = generateDockerfile(port);

        writeFileSync(join(tmpDir, 'server.js'), jsCode);
        writeFileSync(join(tmpDir, 'Dockerfile'), dockerfile);
        console.error('[customTools] Generated server.js and Dockerfile');

        // Build Docker image
        const imageName = `custom-mcp-${definition.name
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')}-${Date.now()}`;
        const imageTag = `${imageName}:latest`;

        console.error(`[customTools] Building Docker image: ${imageTag}`);

        // Stream build output
        const buildStream = await docker.buildImage(
          {
            context: tmpDir,
            src: ['server.js', 'Dockerfile'],
          },
          { t: imageTag }
        );

        await new Promise((resolve, reject) => {
          docker.modem.followProgress(buildStream, (err) => {
            if (err) reject(err);
            else resolve(null);
          });
        });

        console.error(`[customTools] Docker image built successfully: ${imageTag}`);

        // Create container
        const containerName = `custom-mcp-${definition.name
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')}-${Date.now()}`;

        const portStr = `${port}/tcp`;

        newContainer = await docker.createContainer({
          Image: imageTag,
          name: containerName,
          ExposedPorts: {
            [portStr]: {},
          },
          HostConfig: {
            PortBindings: {
              [portStr]: [{ HostPort: String(port) }],
            },
            Binds: [
              'shared-data:/shared-data',
              '/var/run/docker.sock:/var/run/docker.sock',
            ],
          },
          Labels: {
            [mcpLabel]: 'true',
          },
          Env: [
            `PORT=${port}`,
            'NODE_ENV=production',
          ],
        });

        const newContainerId = newContainer.id.slice(0, 12);
        console.error(`[customTools] Container created: ${newContainerId}`);

        // Start container
        await newContainer.start();
        console.error(`[customTools] Container started: ${newContainerId}`);

        // Create shared volume directories if they don't exist
        if (definition.sharedVolumeAccess && definition.sharedVolumeAccess.length > 0) {
          try {
            for (const access of definition.sharedVolumeAccess) {
              const folderPath = access.folder;
              if (folderPath) {
                // Execute mkdir command inside the container
                const exec = await newContainer.exec({
                  Cmd: ['mkdir', '-p', folderPath],
                  AttachStdout: true,
                  AttachStderr: true,
                });
                await exec.start({ Detach: false });
                console.error(`[customTools] Created shared volume directory: ${folderPath}`);
              }
            }
          } catch (err) {
            console.error(`[customTools] Warning: Failed to create shared volume directories:`, err instanceof Error ? err.message : String(err));
            // Don't fail the deployment if directory creation fails
          }
        }

        // Connect to network if it exists
        try {
          const network = docker.getNetwork('mcp-hub-network');
          await network.connect({ Container: newContainer.id });
          console.error(`[customTools] Connected container to mcp-hub-network`);
        } catch (err) {
          console.error(`[customTools] Failed to connect to network:`, err instanceof Error ? err.message : String(err));
        }

        // Update metadata
        const updatedData = loadData();

        // Remove old entry
        delete updatedData[containerId];

        // Add new entry
        updatedData[newContainerId] = {
          name: definition.name,
          image: imageTag,
          command: 'node /app/server.js',
          env: {
            PORT: String(port),
          },
          port,
          transport: 'http',
          isCustomToolsMcp: true,
          containerName,
          customToolDefinition: definition as unknown as Record<string, unknown>,
        };

        // Update any custom namespaces that reference the old container ID
        for (const [mcpId, mcpData] of Object.entries(updatedData)) {
          if (mcpData?.isCustomNamespace && Array.isArray(mcpData.enabledMcps)) {
            const idx = mcpData.enabledMcps.indexOf(containerId);
            if (idx >= 0) {
              mcpData.enabledMcps[idx] = newContainerId;
              console.error(`[customTools] Updated namespace ${mcpId} to reference ${newContainerId} instead of ${containerId}`);

              // Regenerate namespace env variables to reflect the new container ID
              const enabledMcpsList = mcpData.enabledMcps
                .map((id: string) => {
                  const mcp = updatedData[id] as any;
                  if (mcp) {
                    return `${id}:${mcp.name}:${mcp.image}`;
                  }
                  return null;
                })
                .filter(Boolean)
                .join(';');

              const mcpConfigs = mcpData.enabledMcps
                .map((id: string) => {
                  const mcp = updatedData[id] as any;
                  if (!mcp) return null;
                  return {
                    id,
                    name: mcp.name,
                    image: mcp.image,
                    transport: mcp.transport || 'http',
                    port: mcp.port || 8000,
                    command: mcp.command,
                    containerName: mcp.containerName,
                  };
                })
                .filter(Boolean);

              if (mcpData.env) {
                mcpData.env.ENABLED_MCPS = enabledMcpsList;
                mcpData.env.MCP_CONFIGS = JSON.stringify(mcpConfigs);
                console.error(`[customTools] Regenerated namespace ${mcpId} env variables`);
              }
            }
          }
        }

        saveData(updatedData);
        console.error(`[customTools] Updated metadata: removed ${containerId}, added ${newContainerId}`);

        // Restart namespace containers that reference this custom MCP to reload configs
        for (const [mcpId, mcpData] of Object.entries(updatedData)) {
          if (mcpData?.isCustomNamespace && Array.isArray(mcpData.enabledMcps)) {
            if (mcpData.enabledMcps.includes(newContainerId)) {
              try {
                const namespaceContainer = docker.getContainer(mcpId);
                const info = await namespaceContainer.inspect().catch(() => null);
                if (info?.State?.Running) {
                  console.error(`[customTools] Restarting namespace container ${mcpId} to reload configs`);
                  await namespaceContainer.restart();
                }
              } catch (err) {
                console.error(`[customTools] Failed to restart namespace ${mcpId}:`, err instanceof Error ? err.message : String(err));
              }
            }
          }
        }

        return reply.code(200).send({
          success: true,
          containerId: newContainerId,
          containerName,
          message: `Custom MCP "${definition.name}" updated successfully`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[customTools] Update failed:', message);

        // Attempt cleanup
        if (newContainer) {
          try {
            await newContainer.stop();
            await newContainer.remove();
            console.error('[customTools] Cleaned up failed container');
          } catch (cleanupErr) {
            console.error('[customTools] Cleanup error:', cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr));
          }
        }

        return reply.code(500).send({
          success: false,
          message: 'Failed to update custom MCP',
          error: message,
        });
      } finally {
        // Cleanup temp directory
        try {
          rmSync(tmpDir, { recursive: true, force: true });
          console.error(`[customTools] Cleaned up temp directory: ${tmpDir}`);
        } catch (err) {
          console.error(`[customTools] Failed to cleanup temp dir:`, err instanceof Error ? err.message : String(err));
        }
      }
    }
  );

  /**
   * GET /api/containers
   * Lists all running Docker containers
   */
  fastify.get(
    '/api/containers',
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const containers = await docker.listContainers({ all: false });
        const containerList = containers.map((container) => ({
          id: container.Id.slice(0, 12),
          name: container.Names[0]?.replace(/^\//, '') || 'unknown',
          status: container.Status,
          state: container.State,
        }));

        return reply.send({
          containers: containerList,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[customTools] Failed to list containers:', message);
        return reply.code(500).send({
          error: 'Failed to list containers',
          message,
        });
      }
    }
  );
}
