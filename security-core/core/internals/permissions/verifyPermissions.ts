// Copyright 2020-2020 The Mandarine.TS Framework authors. All rights reserved. MIT license.

import { Mandarine } from "../../../../main-core/Mandarine.ns.ts";
import { PermissionValidatorsRegistry } from "./permissionValidatorsRegistry.ts";
import { ReflectUtils } from "../../../../main-core/utils/reflectUtils.ts";

const getExpressionParameters = (expression: string): Array<string> => {
    let str = expression;
    let args: any = /\(\s*([^)]+?)\s*\)/.exec(str);
    if (args[1]) {
        args = args[1].split(/\s*,\s*/);
    }
    return args;
}

const expressionHasParameters = (expression: string) => {
    try {
        getExpressionParameters(expression);
        return true;
    } catch {
        return false;
    }
}

const executeValidator = (permissionLowerName, request, authentication, inputs) => {
    const callValidator = PermissionValidatorsRegistry.getInstance().callValidator(permissionLowerName, request, authentication, inputs);
    if(callValidator === false) {
        return false;
    } else if(callValidator === true) {
        return true;
    }
}

const executeExpression = (expr: string, hasParameters: boolean, request, authentication) => {
    expr = expr.replace(`('`, '(').replace(`("`, '(').replace(`")`, ')').replace(`')`, ')');
    let inputs = undefined;
    if(hasParameters) inputs = getExpressionParameters(expr);
    return executeValidator(expr.toLowerCase(), request, authentication, inputs)
};

const processExpression = (expression: string, request, authentication): boolean => {
    const divideExpression = expression.split(/(?!\(.*)\s(?![^(]*?\))/g);
    const evaluation = [];
    divideExpression.forEach((expr) => {

        if(expr === "OR" || expr === "AND" || expr === "||" || expr === "&&") {
            if(expr === "OR") expr = "||";
            if(expr === "AND") expr = "&&";
            evaluation.push(expr);
            return;
        }
        const hasParameters = expressionHasParameters(expr);
        let execution;
        if(hasParameters) {
            execution = executeExpression(expr, hasParameters, request, authentication);
        } else if(expr.endsWith("()") || expr.endsWith("();")) {
            execution = executeExpression(expr, false, request, authentication);
        } else {
            execution = expr;
        }
        evaluation.push(String(execution));
    });

    const finalEvaluation = eval(`(${evaluation.join(" ")})`);

    return finalEvaluation;
}

export const VerifyPermissions = (permissions: Mandarine.Security.Auth.Permissions, request: any): boolean => {
    const authentication = (request.authentication) ? Object.assign({}, request.authentication) : undefined;
    const currentRoles = (<Array<string>>(authentication?.AUTH_PRINCIPAL?.roles))?.map((role) => role.toLowerCase());
    let isAllowed: boolean = true;

    if(Array.isArray(permissions)) {
        for(const permission of permissions) {
            const permissionLower = permission.toLowerCase();
            const expressionHasParametersStatement = expressionHasParameters(permissionLower);
            if((permissionLower.endsWith("()") || permissionLower.endsWith("();")) || expressionHasParametersStatement) {
                let callValidator = processExpression(permission, request, authentication);
                if(callValidator === false) {
                    isAllowed = false;
                } else if(callValidator === true) {
                    isAllowed = true;
                    break;
                }
                continue;
            } else {
                if(currentRoles === undefined || currentRoles?.length === 0) {
                    isAllowed = false;
                    break;
                } else {
                    if(currentRoles.includes(permissionLower)) {
                        isAllowed = true;
                        break;
                    } else {
                        isAllowed = false;
                    }
                }
            }
        }
    } else if(typeof permissions === 'string') {
        isAllowed = processExpression(permissions, request, authentication);
    }

    return isAllowed;
}