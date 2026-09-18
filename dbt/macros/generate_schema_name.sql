{#- Use the configured schema name as-is (raw, staging, core, marts), not dbt's
    default "<target>_<custom>" concatenation, so the layers match the foundation SQL. -#}
{% macro generate_schema_name(custom_schema_name, node) -%}
  {%- if custom_schema_name is none -%}{{ target.schema }}{%- else -%}{{ custom_schema_name | trim }}{%- endif -%}
{%- endmacro %}
