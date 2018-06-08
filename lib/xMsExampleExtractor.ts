// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import * as util from "util"
import * as fs from "fs"
import * as pathlib from "path"
import * as recursive from "recursive-readdir"
import * as utils from "./util/utils"
import { log } from "./util/logging"

/**
 * @class
 */
export class XMsExampleExtractor {
  private specPath: string
  private recordings: any
  private specDir: any
  private options: any
  /**
   * @constructor
   * Initializes a new instance of the xMsExampleExtractor class.
   *
   * @param {string} specPath the swagger spec path
   *
   * @param {object} recordings the folder for recordings
   *
   * @param {object} [options] The options object
   *
   * @param {object} [options.matchApiVersion] Only generate examples if api-version matches.
   * Default: false
   *
   * @param {object} [options.output] Output folder for the generated examples.
   */
  constructor(specPath: string, recordings: any, options: any) {
    if (specPath === null
      || specPath === undefined
      || typeof specPath.valueOf() !== "string"
      || !specPath.trim().length) {
      throw new Error(
        "specPath is a required property of type string and it cannot be an empty string.")
    }

    if (recordings === null
      || recordings === undefined
      || typeof recordings.valueOf() !== "string"
      || !recordings.trim().length) {
      throw new Error(
        "recordings is a required property of type string and it cannot be an empty string.")
    }

    this.specPath = specPath
    this.recordings = recordings
    this.specDir = pathlib.dirname(this.specPath)
    if (!options) { options = {} }
    if (options.output === null || options.output === undefined) {
      options.output = process.cwd() + "/output"
    }
    if (options.shouldResolveXmsExamples === null
      || options.shouldResolveXmsExamples === undefined) {
      options.shouldResolveXmsExamples = true
    }
    if (options.matchApiVersion === null || options.matchApiVersion === undefined) {
      options.matchApiVersion = false
    }

    this.options = options
    log.debug(`specPath : ${this.specPath}`)
    log.debug(`recordings : ${this.recordings}`)
    log.debug(`options.output : ${this.options.output}`)
    log.debug(`options.matchApiVersion : ${this.options.matchApiVersion}`)
  }

  /**
   * Extracts x-ms-examples from the recordings
   */
  public async extract(): Promise<void> {
    const self = this
    self.mkdirSync(self.options.output)
    self.mkdirSync(self.options.output + "/examples")
    self.mkdirSync(self.options.output + "/swagger")

    const outputExamples = self.options.output + "/examples/"
    const relativeExamplesPath = "../examples/"
    const specName = self.specPath.split("/")
    const outputSwagger =
      self.options.output + "/swagger/" + specName[specName.length - 1].split(".")[0] + ".json"

    const swaggerObject = require(self.specPath)
    const SwaggerParser = require("swagger-parser")
    const parser = new SwaggerParser()

    const accErrors: any = {}
    const filesArray: any = []
    self.getFileList(self.recordings, filesArray)

    const recordingFiles = filesArray
    const example = {}

    try {
      const api = await parser.parse(swaggerObject)
      for (const recordingFileName of utils.getValues<any>(recordingFiles)) {
        log.debug(`Processing recording file: ${recordingFileName}`)

        try {
          const recording = JSON.parse(fs.readFileSync(recordingFileName).toString())
          const paths = api.paths
          let pathIndex = 0
          let pathParams: any = {}
          for (const path of utils.getKeys(paths)) {
            pathIndex++
            const searchResult = path.match(/\/{\w*\}/g)
            const pathParts = path.split("/")
            let pathToMatch = path
            pathParams = {}
            for (const match of utils.getValues<any>(searchResult)) {
              const splitRegEx = /[{}]/
              const pathParam = match.split(splitRegEx)[1]

              for (const part of utils.getKeys(pathParts)) {
                const pathPart = "/" + pathParts[part as any]
                if (pathPart.localeCompare(match) === 0) {
                  pathParams[pathParam] = part
                }
              }
              pathToMatch = pathToMatch.replace(match, "/[^\/]+")
            }
            let newPathToMatch = pathToMatch.replace(/\//g, "\\/")
            newPathToMatch = newPathToMatch + "$"

            // for this API path (and method), try to find it in the recording file, and get
            // the data
            const entries = recording.Entries
            let entryIndex = 0
            const queryParams: any = {}
            for (const entry of utils.getKeys(entries)) {
              entryIndex++
              let recordingPath = JSON.stringify(entries[entry].RequestUri)
              const recordingPathQueryParams = recordingPath.split("?")[1].slice(0, -1)
              const queryParamsArray = recordingPathQueryParams.split("&")
              for (const part of utils.getKeys(queryParamsArray)) {
                const queryParam = queryParamsArray[part as any].split("=")
                queryParams[queryParam[0]] = queryParam[1]
              }

              const headerParams = entries[entry].RequestHeaders

              // if commandline included check for API version, validate api-version from URI in
              // recordings matches the api-version of the spec
              if (!self.options.matchApiVersion
                || (("api-version" in queryParams)
                  && queryParams["api-version"] === api.info.version)) {
                recordingPath = recordingPath.replace(/\?.*/, "")
                const recordingPathParts = recordingPath.split("/")
                const match = recordingPath.match(newPathToMatch)
                if (match !== null) {
                  log.silly("path: " + path)
                  log.silly("recording path: " + recordingPath)

                  const pathParamsValues: any = {}
                  for (const p of utils.getKeys(pathParams)) {
                    const index = pathParams[p]
                    pathParamsValues[p] = recordingPathParts[index]
                  }

                  // found a match in the recording
                  const requestMethodFromRecording = entries[entry].RequestMethod
                  const infoFromOperation = paths[path][requestMethodFromRecording.toLowerCase()]
                  if (typeof infoFromOperation !== "undefined") {
                    // need to consider each method in operation
                    let fileName = recordingFileName.split("/")
                    fileName = fileName[fileName.length - 1]
                    fileName = fileName.split(".json")[0]
                    fileName = fileName.replace(/\//g, "-")
                    const exampleFileName = fileName
                      + "-"
                      + requestMethodFromRecording
                      + "-example-"
                      + pathIndex
                      + entryIndex
                      + ".json"
                    const ref: any = {}
                    ref.$ref = relativeExamplesPath + exampleFileName
                    const exampleFriendlyName =
                      fileName + requestMethodFromRecording + pathIndex + entryIndex
                    log.debug(`exampleFriendlyName: ${exampleFriendlyName}`)

                    if (!("x-ms-examples" in infoFromOperation)) {
                      infoFromOperation["x-ms-examples"] = {}
                    }
                    infoFromOperation["x-ms-examples"][exampleFriendlyName] = ref
                    const exampleL = {
                      parameters: {} as any,
                      responses: {} as any
                    }
                    const params = infoFromOperation.parameters
                    for (const param of utils.getKeys(pathParamsValues)) {
                      exampleL.parameters[param] = pathParamsValues[param]
                    }
                    for (const param of utils.getKeys(queryParams)) {
                      exampleL.parameters[param] = queryParams[param]
                    }
                    for (const param of utils.getKeys(headerParams)) {
                      exampleL.parameters[param] = headerParams[param]
                    }
                    for (const param of utils.getKeys(infoFromOperation.parameters)) {
                      if (params[param].in === "body") {
                        const bodyParamName = params[param].name
                        const bodyParamValue = entries[entry].RequestBody
                        const bodyParamExample: any = {}
                        bodyParamExample[bodyParamName] = bodyParamValue

                        if (bodyParamValue !== "") {
                          exampleL.parameters[bodyParamName] = JSON.parse(bodyParamValue)
                        } else {
                          exampleL.parameters[bodyParamName] = ""
                        }
                      }
                    }
                    const responses = infoFromOperation.responses
                    for (const response of utils.getKeys(responses)) {
                      const statusCodeFromRecording = entries[entry].StatusCode
                      const responseBody = entries[entry].ResponseBody
                      exampleL.responses[statusCodeFromRecording] = {}
                      if (responseBody !== "") {
                        exampleL.responses[statusCodeFromRecording].body = JSON.parse(responseBody)
                      } else {
                        exampleL.responses[statusCodeFromRecording].body = ""
                      }
                    }
                    log.info(`Writing x-ms-examples at ${outputExamples + exampleFileName}`)
                    fs.writeFileSync(
                      outputExamples + exampleFileName, JSON.stringify(exampleL, null, 2))
                  }
                }
              }
            }
          }
          log.info(`Writing updated swagger with x-ms-examples at ${outputSwagger}`)
          fs.writeFileSync(outputSwagger, JSON.stringify(swaggerObject, null, 2))
        } catch (err) {
          accErrors[recordingFileName] = err.toString()
          log.warn(`Error processing recording file: "${recordingFileName}"`)
          log.warn(`Error: "${err.toString()} "`)
        }
      }

      if (JSON.stringify(accErrors) !== "{}") {
        log.error(`Errors loading/parsing recording files.`)
        log.error(`${JSON.stringify(accErrors)}`)
      }
    } catch (err) {
      process.exitCode = 1
      log.error(err)
    }
  }

  private mkdirSync(path: any): void {
    try {
      fs.mkdirSync(path)
    } catch (e) {
      if (e.code !== "EEXIST") { throw e }
    }
  }

  private getFileList(dir: string, fileList: string[]): string[] {
    const self = this
    const files = fs.readdirSync(dir)
    fileList = fileList || []
    files.forEach(file => {
      if (fs.statSync(pathlib.join(dir, file)).isDirectory()) {
        fileList = self.getFileList(pathlib.join(dir, file), fileList)
      } else {
        fileList.push(pathlib.join(dir, file))
      }
    });
    return fileList
  }
}
