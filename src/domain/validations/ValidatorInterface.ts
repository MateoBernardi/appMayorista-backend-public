export interface Validator{
    validateTypes(data: any): any[];
    validateValues(data: any): any[];
    validateData(data: any): any[];
}