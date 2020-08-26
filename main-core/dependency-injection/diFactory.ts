// Copyright 2020-2020 The Mandarine.TS Framework authors. All rights reserved. MIT license.

import { Cookies } from "../../deps.ts";
import { ComponentsRegistry, Mandarine, ViewModel } from "../../mod.ts";
import { RoutingUtils } from "../../mvc-framework/core/utils/mandarine/routingUtils.ts";
import { ApplicationContext } from "../application-context/mandarineApplicationContext.ts";
import { MandarineConstants } from "../mandarineConstants.ts";
import { Reflect } from "../reflectMetadata.ts";
import { HttpUtils } from "../utils/httpUtils.ts";
import { ReflectUtils } from "../utils/reflectUtils.ts";
import { DI } from "./di.ns.ts";
import { getPipes } from "./internals/getPipes.ts";
import { MandarineException } from "../exceptions/mandarineException.ts";

export class DependencyInjectionFactory {

    /** 
     * Resolve dependencies from a component's constructor. This method will look for the requested dependencies in the DI Container at mandarine compile time.
     *
     */
    public constructorResolver<T>(componentSource: Mandarine.MandarineCore.ComponentRegistryContext, componentRegistry: Mandarine.MandarineCore.IComponentsRegistry): T {
        if(componentSource.componentType == Mandarine.MandarineCore.ComponentTypes.MANUAL_COMPONENT ||
            componentSource.componentType == Mandarine.MandarineCore.ComponentTypes.REPOSITORY) return;

        let target: DI.Constructor<T> = componentSource.componentInstance.getClassHandler();

        const providers = Reflect.getMetadata('design:paramtypes', target);
        const args = providers.map((provider: DI.Constructor) => {
        let component: Mandarine.MandarineCore.ComponentRegistryContext = componentRegistry.getComponentByHandlerType(provider);
            if(component != (undefined || null)) {
                let isComponentManual = component.componentType == Mandarine.MandarineCore.ComponentTypes.MANUAL_COMPONENT; 
                let classHandler: any = (isComponentManual) ? component.componentInstance : component.componentInstance.getClassHandler();

                // It is never initialized when it gets here.
                return (isComponentManual || ReflectUtils.checkClassInitialized(classHandler)) ? classHandler : new classHandler();
            } else {
                return undefined;
            }
        });

        return new target(...args);
    }

    /** 
     * Resolves all the dependencies a component has (Fields and constructor). 
     * **Note** MANUAL_COMPONENTS are not resolved since they were theorically resolved by the user.
     *
     */
    public componentDependencyResolver(componentRegistry: ComponentsRegistry) {
        // Initialize all components

        const ignoreComponentIf = (component): boolean => component.componentType == Mandarine.MandarineCore.ComponentTypes.MANUAL_COMPONENT || component.componentType == Mandarine.MandarineCore.ComponentTypes.REPOSITORY;

        componentRegistry.getAllComponentNames().forEach((componentName) => {
            let component: Mandarine.MandarineCore.ComponentRegistryContext = componentRegistry.get(componentName);
    
            if(ignoreComponentIf(component)) {
                return;
            }
    
            let componentClassHandler = component.componentInstance.getClassHandler();
    
            if(ReflectUtils.constructorHasParameters(componentClassHandler)) {
                component.componentInstance.setClassHandler(this.constructorResolver(component, componentRegistry));
            } else {
                component.componentInstance.setClassHandler(new componentClassHandler());
            }
        });
        
        // Initialize manual injections after components have been initialized
        componentRegistry.getAllComponentNames().forEach((componentName) => {
            let component: Mandarine.MandarineCore.ComponentRegistryContext = componentRegistry.get(componentName);
    
            if(ignoreComponentIf(component)) {
                return;
            }

            let componentHandler: any = component.componentInstance.getClassHandler();
    
            let reflectMetadataInjectionKeys = Reflect.getMetadataKeys(componentHandler);
            if(reflectMetadataInjectionKeys != (undefined || null)) {
                reflectMetadataInjectionKeys = reflectMetadataInjectionKeys.filter((metadataKey: string) => metadataKey.startsWith(`${MandarineConstants.REFLECTION_MANDARINE_INJECTABLE_FIELD}:`));
                if(reflectMetadataInjectionKeys != (undefined || null)) {
                    (<Array<string>>reflectMetadataInjectionKeys).forEach((metadataKey) => {
                        let metadata: {propertyType: any, propertyName: string, propertyTypeName: string} = Reflect.getMetadata(metadataKey, componentHandler);
                        let injectableComponent: any = componentRegistry.getComponentByHandlerType(metadata.propertyType);
                        if(injectableComponent != (null || undefined)) {
                            let injectableHandler = (injectableComponent.componentType == Mandarine.MandarineCore.ComponentTypes.MANUAL_COMPONENT) ? injectableComponent.componentInstance : injectableComponent.componentInstance.getClassHandler();
                            componentHandler[metadata.propertyName] = injectableHandler;
                        }
                    });
                }
            }
        })
    }

    /** 
     * Resolves all the requested data by a HTTP Handler method.
     * This function is used when requests are received
     *
     */
    public async methodArgumentResolver(object: any, methodName: string, extraData: DI.ArgumentsResolverExtraData) {
        const args: Array<DI.ArgumentValue> = [];
        let componentMethodParams: Array<string> = ReflectUtils.getParamNames(object[methodName]);
    
        let methodAnnotationMetadata: Array<any> = Reflect.getMetadataKeys(object, methodName);
        let methodInjectableDependencies: Array<any> = methodAnnotationMetadata.filter((metadataKey: string) => metadataKey.startsWith(`${MandarineConstants.REFLECTION_MANDARINE_INJECTION_FIELD}:PARAMETER`));
        if(methodInjectableDependencies == null) return args;
    
        let metadataValues: Array<DI.InjectionMetadataContext> = new Array<DI.InjectionMetadataContext>();
    
        methodInjectableDependencies.forEach((dependencyMetadataKey: string) => {
            let metadataValue: DI.InjectionMetadataContext = <DI.InjectionMetadataContext> Reflect.getMetadata(dependencyMetadataKey, object, methodName);
            metadataValues.push(metadataValue);
        });
    
        metadataValues = metadataValues.sort((a, b) => a.parameterIndex - b.parameterIndex);
    
        const queryParams = RoutingUtils.findQueryParams(extraData.request.url.toString());
        const requestCookies: Cookies = extraData.cookies;
    
        for(let i = 0; i < componentMethodParams.length; i++) {
            const pipes: Array<any> | any = getPipes(object, i, methodName);
            if(!metadataValues.some((injectionMetadata: DI.InjectionMetadataContext) => injectionMetadata.parameterIndex === i)) {
                args.push(undefined);
            } else {
                const param = metadataValues.find(injectionMetadata => injectionMetadata.parameterIndex === i);
                
                let valueToInject: any = undefined;
                switch(param.injectionType) {
                    case DI.InjectionTypes.QUERY_PARAM:
                        if(queryParams) {
                            valueToInject = queryParams.get(param.parameterName);
                        }
                        break;
                    case DI.InjectionTypes.ROUTE_PARAM:
                        if(extraData.params) {
                            valueToInject = extraData.params[param.parameterName];
                        }
                        break;
                    case DI.InjectionTypes.REQUEST_PARAM:
                        valueToInject = extraData.request;
                        break;
                    case DI.InjectionTypes.SESSION_PARAM:
                        valueToInject = (<any> extraData.request).session;
                        break;
                    case DI.InjectionTypes.SERVER_REQUEST_PARAM:
                        valueToInject = extraData.request.serverRequest;
                    break;
                    case DI.InjectionTypes.REQUEST_BODY_PARAM:
                        valueToInject = await HttpUtils.parseBody(extraData.request);
                    break;
                    case DI.InjectionTypes.RESPONSE_PARAM:
                        valueToInject = extraData.response;
                        break;
                    case DI.InjectionTypes.COOKIE_PARAM:
                        if(requestCookies.get(param.parameterName)) {
                            valueToInject = requestCookies.get(param.parameterName);
                        }
                        break;
                    case DI.InjectionTypes.INJECTABLE_OBJECT:
                        let injectableComponent = ApplicationContext.getInstance().getComponentsRegistry().getComponentByHandlerType(param.parameterObjectToInject);

                        if(injectableComponent != (null || undefined)) {
                            valueToInject = (injectableComponent.componentType == Mandarine.MandarineCore.ComponentTypes.MANUAL_COMPONENT) ? injectableComponent.componentInstance : injectableComponent.componentInstance.getClassHandler();
                        }
                        
                        break;
                    case DI.InjectionTypes.TEMPLATE_MODEL_PARAM:
                        valueToInject = new ViewModel();
                        break;
                    case DI.InjectionTypes.PARAMETERS_PARAM:
                        const allParameters: Mandarine.MandarineMVC.AllParameters = { 
                            query: Object.fromEntries(queryParams), 
                            route: extraData.params 
                        };
                        valueToInject = allParameters;
                        break;
                    case DI.InjectionTypes.REQUEST_CONTEXT_PARAM:
                        valueToInject = extraData.fullContext;
                        break;
                    case DI.InjectionTypes.AUTH_PRINCIPAL_PARAM:
                        valueToInject = (extraData.request as any).authentication?.AUTH_PRINCIPAL;
                        break;
                }

                const executePipe = (pipe: any) => {
                    const pipeFromDI: Mandarine.Types.PipeTransform = this.getDependency(pipe);
                    if(pipeFromDI) {
                        valueToInject = pipeFromDI.transform(valueToInject);
                    } else if(!pipeFromDI && typeof pipe === 'function') {
                        valueToInject = pipe(valueToInject);
                    } else {
                        throw new MandarineException(MandarineException.INVALID_PIPE_EXECUTION);
                    }
                }

                if(pipes) {
                    if(Array.isArray(pipes)) {
                        pipes.forEach((pipe) => {
                            executePipe(pipe);
                        })
                    } else {
                        executePipe(pipes);
                    }
                }

                args.push(valueToInject);
            }
        }
    
        if (args.length == 0) return null;
        return args;
    }

    /** 
     * Get a Dependency from the DI Container programatically
     */
    public getDependency(type: any) {
        let component = ApplicationContext.getInstance().getComponentsRegistry().getComponentByHandlerType(type);
        if(component != (null || undefined)) return (component.componentType == Mandarine.MandarineCore.ComponentTypes.MANUAL_COMPONENT) ? component.componentInstance : component.componentInstance.getClassHandler();
    }

    /** 
     * Get a Dependency from the DI Container programatically
     */
    public getSeed(type: any) {
        return this.getDependency(type);
    }

    /** 
     * Get a Dependency from the DI Container programatically
     */
    public getInjectable(type: any) {
        return this.getDependency(type);
    }

    /**
     * Get component of dependency by Type
     */
    public getComponentByType(type: any) {
        let component = ApplicationContext.getInstance().getComponentsRegistry().getComponentByHandlerType(type);
        if(component != (null || undefined) && component.componentType !== Mandarine.MandarineCore.ComponentTypes.MANUAL_COMPONENT) {
            return component.componentInstance;
        }
    }

    /**
     * Get component of dependency by component type
     */
    public getComponentsByComponentType<T>(type: Mandarine.MandarineCore.ComponentTypes): Array<T> {
        return ApplicationContext.getInstance().getComponentsRegistry().getComponentsByComponentType(type).map((item) => item.componentInstance);
    }
}