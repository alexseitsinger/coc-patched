import * as path from "path";

import fastDiff from "fast-diff";
import resolveFrom from "resolve-from";
import { TextDocument, TextEdit } from "vscode-languageserver";
import { URI } from "vscode-uri";

import { CLIOptions, Is, TextDocumentSettings } from "./types";

interface Change {
  start: number;
  end: number;
  newText: string;
}

const enum CharCode {
  /**
   * The `\` character.
   */
  Backslash = 92
}

/**
 * Check if the path follows this pattern: `\\hostname\sharename`.
 *
 * @see https://msdn.microsoft.com/en-us/library/gg465305.aspx
 * @return A boolean indication if the path is a UNC path, on none-windows
 * always false.
 */
export function isUNC(path: string): boolean {
  if (process.platform !== "win32") {
    // UNC is a windows concept
    return false;
  }

  if (!path || path.length < 5) {
    // at least \\a\b
    return false;
  }

  let code = path.charCodeAt(0);
  if (code !== CharCode.Backslash) {
    return false;
  }
  code = path.charCodeAt(1);
  if (code !== CharCode.Backslash) {
    return false;
  }
  let pos = 2;
  const start = pos;
  for (; pos < path.length; pos++) {
    code = path.charCodeAt(pos);
    if (code === CharCode.Backslash) {
      break;
    }
  }
  if (start === pos) {
    return false;
  }
  code = path.charCodeAt(pos + 1);
  if (isNaN(code) || code === CharCode.Backslash) {
    return false;
  }
  return true;
}

function getFileSystemPath(uri: URI): string {
  const result = uri.fsPath;
  if (process.platform === "win32" && result.length >= 2 && result[1] === ":") {
    /*
     * Node by default uses an upper case drive letter and ESLint uses
     * === to compare pathes which results in the equal check failing
     * if the drive letter is lower case in th URI. Ensure upper case.
     */
    return result[0].toUpperCase() + result.slice(1);
  }
  return result;
}

export function getFilePath(documentOrUri: string | TextDocument): string {
  if (!documentOrUri) {
    return undefined;
  }
  const uri = Is.string(documentOrUri)
    ? URI.parse(documentOrUri)
    : URI.parse(documentOrUri.uri);
  if (uri.scheme !== "file") {
    return undefined;
  }
  return getFileSystemPath(uri);
}

export function getAllFixEdits(
  document: TextDocument,
  settings: TextDocumentSettings
): TextEdit[] {
  const uri = URI.parse(document.uri);
  if (uri.scheme != "file") return [];
  const content = document.getText();
  const newOptions: CLIOptions = { ...settings.options, fix: true };
  return executeInWorkspaceDirectory(
    document,
    settings,
    newOptions,
    (filename: string, options: CLIOptions) => {
      if (!settings.validate) {
        return [];
      }
      const engine = new settings.library.CLIEngine(options);
      const res = engine.executeOnText(content, filename);
      if (!res.results.length) return [];

      const { output } = res.results[0];
      if (output == null) return [];

      const change = getChange(content, output);
      return [
        {
          range: {
            start: document.positionAt(change.start),
            end: document.positionAt(change.end)
          },
          newText: change.newText
        }
      ];
    }
  );
}

export function getChange(oldString, newString): Change {
  const result = fastDiff(oldString, newString, 1);
  let current = 0;
  let start = -1;
  let end = -1;
  let newText = "";
  let remain = "";
  result.forEach(item => {
    const [t, string] = item;
    // equal
    if (t === 0) {
      current += string.length;
      if (start !== -1) remain += string;
    }
else {
      if (start === -1) start = current;
      if (t === 1) {
        newText = newText + remain + string;
        end = current;
      }
 else {
        newText += remain;
        end = current + string.length;
      }
      remain = "";
      if (t === -1) current += string.length;
    }
  });
  return { start, end, newText };
}

export function resolveModule(
  name: string,
  localPath: string,
  globalPath: string
): Promise<string> {
  if (localPath) {
    const path = resolveFrom.silent(localPath, name);
    if (path) return Promise.resolve(path);
  }
  try {
    const path = resolveFrom(globalPath, name);
    return await Promise.resolve(path);
  } catch (error) {
    return await Promise.reject(error);
  }
}

export function executeInWorkspaceDirectory(
  document: TextDocument,
  settings: TextDocumentSettings,
  newOptions: CLIOptions,
  callback: Function
): TextEdit[] {
  const filename = getFilePath(document);
  const cwd = process.cwd();
  try {
    if (filename) {
      if (settings.workingDirectory) {
        newOptions.cwd = settings.workingDirectory.directory;
        if (settings.workingDirectory.changeProcessCWD) {
          process.chdir(settings.workingDirectory.directory);
        }
      } else if (settings.workspaceFolder) {
        const workspaceFolderUri = URI.parse(settings.workspaceFolder.uri);
        if (workspaceFolderUri.scheme === "file") {
          const fsPath = getFileSystemPath(workspaceFolderUri);
          newOptions.cwd = fsPath;
          process.chdir(fsPath);
        }
      } else if (!settings.workspaceFolder && !isUNC(filename)) {
        const directory = path.dirname(filename);
        if (directory && path.isAbsolute(directory)) newOptions.cwd = directory;
      }
    }

    return callback(filename, newOptions);
  } finally {
    if (cwd !== process.cwd()) process.chdir(cwd);
  }
}
